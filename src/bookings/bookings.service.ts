import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

import { eachNight, toIsoDay, toUtcDate } from '../common/dates';
import { envs } from '../config';
import { Booking, Prisma } from '../generated/prisma/client';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBookingDto } from './dto';
import type { BookingGroup } from './dto';

const MAX_NIGHTS = 30;
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 25;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async create(dto: CreateBookingDto) {
    const checkIn = toUtcDate(dto.checkIn);
    const checkOut = toUtcDate(dto.checkOut);
    const nights = eachNight(checkIn, checkOut);

    if (nights.length < 1) {
      throw this.outsideCalendar('The check-out date must be after check-in');
    }

    if (nights.length > MAX_NIGHTS) {
      throw this.outsideCalendar(`A stay cannot exceed ${MAX_NIGHTS} nights`);
    }

    const roomType = await this.prisma.roomTypeReplica.findUnique({
      where: { id: dto.roomTypeId },
    });

    if (!roomType || !roomType.active) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Room type ${dto.roomTypeId} is not bookable`,
      });
    }

    const idempotencyKey = dto.idempotencyKey ?? randomUUID();

    const existing = await this.prisma.booking.findUnique({
      where: { idempotencyKey },
    });

    if (existing) {
      return this.present(existing);
    }

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.reserve(dto, roomType, nights, idempotencyKey);
      } catch (error) {
        if (this.isDuplicateKey(error)) {
          return this.replayed(idempotencyKey);
        }

        if (attempt >= MAX_ATTEMPTS || !this.isRetryable(error)) {
          throw error;
        }

        const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
        await delay(backoff * (0.5 + Math.random()));
      }
    }
  }

  private reserve(
    dto: CreateBookingDto,
    roomType: { hotelId: string; priceCents: number; currency: string },
    nights: string[],
    idempotencyKey: string,
  ) {
    const units = dto.units ?? 1;

    return this.prisma.$transaction(
      async (tx) => {
        if (envs.bookingStrategy === 'naive') {
          await this.holdNaive(tx, dto, nights, units);
        } else {
          await this.holdAtomic(tx, dto, nights, units);
        }

        const booking = await tx.booking.create({
          data: {
            userId: dto.userId,
            hotelId: roomType.hotelId,
            roomTypeId: dto.roomTypeId,
            checkIn: toUtcDate(dto.checkIn),
            checkOut: toUtcDate(dto.checkOut),
            units,
            status: 'held',
            totalCents: roomType.priceCents * nights.length * units,
            currency: roomType.currency,
            idempotencyKey,
            expiresAt: new Date(Date.now() + envs.holdTtlMinutes * 60_000),
          },
        });

        await this.outbox.enqueue(tx, booking.id, 'booking.held', {
          bookingId: booking.id,
          userId: booking.userId,
          hotelId: booking.hotelId,
          roomTypeId: booking.roomTypeId,
          checkIn: toIsoDay(booking.checkIn),
          checkOut: toIsoDay(booking.checkOut),
          units: booking.units,
          totalCents: booking.totalCents,
          currency: booking.currency,
        });

        return this.present(booking);
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
  }

  private async holdNaive(
    tx: Prisma.TransactionClient,
    dto: CreateBookingDto,
    nights: string[],
    units: number,
  ) {
    const dates = nights.map(toUtcDate);

    const rows = await tx.inventory.findMany({
      where: { roomTypeId: dto.roomTypeId, date: { in: dates } },
    });

    if (rows.length !== nights.length) {
      throw this.outsideCalendar('Some nights are outside the loaded calendar');
    }

    if (rows.some((row) => row.totalUnits - row.reservedUnits < units)) {
      throw this.soldOut();
    }

    await tx.inventory.updateMany({
      where: { roomTypeId: dto.roomTypeId, date: { in: dates } },
      data: { reservedUnits: { increment: units } },
    });
  }

  private async holdAtomic(
    tx: Prisma.TransactionClient,
    dto: CreateBookingDto,
    nights: string[],
    units: number,
  ) {
    for (const night of nights) {
      const updated = await tx.$executeRaw`
        UPDATE inventory
        SET    reserved_units = reserved_units + ${units}
        WHERE  room_type_id = ${dto.roomTypeId}::uuid
          AND  date = ${night}::date
          AND  reserved_units + ${units} <= total_units
      `;

      if (updated === 0) {
        const row = await tx.inventory.findUnique({
          where: {
            roomTypeId_date: {
              roomTypeId: dto.roomTypeId,
              date: toUtcDate(night),
            },
          },
        });

        throw row
          ? this.soldOut()
          : this.outsideCalendar(`No calendar loaded for ${night}`);
      }
    }
  }

  async findOne(id: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });

    if (!booking || booking.userId !== userId) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Booking ${id} not found`,
      });
    }

    return this.present(booking);
  }

  async findMine(
    userId: string,
    page = 1,
    limit = 20,
    group: BookingGroup = 'active',
  ) {
    const where = { userId, ...this.groupFilter(group) };

    const [data, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      data: data.map((booking) => this.present(booking)),
      meta: { page, limit, total, lastPage: Math.ceil(total / limit) || 1 },
    };
  }

  private groupFilter(group: BookingGroup): Prisma.BookingWhereInput {
    const today = toUtcDate(toIsoDay(new Date()));

    if (group === 'past') {
      return { status: 'confirmed', checkOut: { lt: today } };
    }

    if (group === 'cancelled') {
      return { status: { in: ['cancelled', 'refunded'] } };
    }

    return {
      status: { in: ['held', 'confirmed'] },
      checkOut: { gte: today },
    };
  }

  async cancel(id: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });

    if (!booking || booking.userId !== userId) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Booking ${id} not found`,
      });
    }

    if (booking.status !== 'held' && booking.status !== 'confirmed') {
      throw new RpcException({
        status: HttpStatus.CONFLICT,
        message: `A ${booking.status} booking cannot be cancelled`,
      });
    }

    const today = toUtcDate(toIsoDay(new Date()));

    if (booking.status === 'confirmed' && booking.checkIn <= today) {
      throw new RpcException({
        status: HttpStatus.CONFLICT,
        message: 'A stay that has already started cannot be cancelled',
      });
    }

    const refundable =
      booking.status === 'confirmed' &&
      !!booking.refundableUntil &&
      booking.refundableUntil > new Date();

    const cancelled = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.booking.updateMany({
        where: { id, status: booking.status },
        data: { status: 'cancelled' },
      });

      if (claimed.count === 0) {
        return null;
      }

      await this.release(tx, booking);

      await this.outbox.enqueue(tx, booking.id, 'booking.cancelled', {
        bookingId: booking.id,
        userId: booking.userId,
        previousStatus: booking.status,
        refundable,
      });

      if (refundable) {
        await this.outbox.enqueue(tx, booking.id, 'payment.refund.requested', {
          bookingId: booking.id,
          userId: booking.userId,
          reason: 'cancelled by the guest',
        });
      }

      return tx.booking.findUnique({ where: { id } });
    });

    if (!cancelled) {
      throw new RpcException({
        status: HttpStatus.CONFLICT,
        message: 'The booking changed state while cancelling',
      });
    }

    return this.present(cancelled);
  }

  async reacquire(tx: Prisma.TransactionClient, booking: Booking) {
    const taken: string[] = [];

    for (const night of eachNight(booking.checkIn, booking.checkOut)) {
      const updated = await tx.$executeRaw`
        UPDATE inventory
        SET    reserved_units = reserved_units + ${booking.units}
        WHERE  room_type_id = ${booking.roomTypeId}::uuid
          AND  date = ${night}::date
          AND  reserved_units + ${booking.units} <= total_units
      `;

      if (updated === 0) {
        for (const done of taken) {
          await tx.$executeRaw`
            UPDATE inventory
            SET    reserved_units = reserved_units - ${booking.units}
            WHERE  room_type_id = ${booking.roomTypeId}::uuid
              AND  date = ${done}::date
              AND  reserved_units >= ${booking.units}
          `;
        }

        return false;
      }

      taken.push(night);
    }

    return true;
  }

  async extendHold(id: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });

    if (!booking || booking.userId !== userId) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Booking ${id} not found`,
      });
    }

    const until = new Date(Date.now() + envs.paymentWindowMinutes * 60_000);
    const expiresAt = booking.expiresAt;

    if (
      booking.status !== 'held' ||
      !expiresAt ||
      expiresAt <= new Date() ||
      expiresAt >= until
    ) {
      return this.present(booking);
    }

    const extended = await this.prisma.booking.updateMany({
      where: { id, status: 'held' },
      data: { expiresAt: until },
    });

    if (extended.count === 0) {
      return this.present(booking);
    }

    this.logger.log(`Extended the hold on ${id} while the payment runs`);

    return this.present({ ...booking, expiresAt: until });
  }

  async release(tx: Prisma.TransactionClient, booking: Booking) {
    for (const night of eachNight(booking.checkIn, booking.checkOut)) {
      await tx.$executeRaw`
        UPDATE inventory
        SET    reserved_units = reserved_units - ${booking.units}
        WHERE  room_type_id = ${booking.roomTypeId}::uuid
          AND  date = ${night}::date
          AND  reserved_units >= ${booking.units}
      `;
    }
  }

  private async replayed(idempotencyKey: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { idempotencyKey },
    });

    if (!booking) {
      throw this.soldOut();
    }

    return this.present(booking);
  }

  private present(booking: Booking) {
    return {
      bookingId: booking.id,
      status: booking.status,
      roomTypeId: booking.roomTypeId,
      hotelId: booking.hotelId,
      checkIn: toIsoDay(booking.checkIn),
      checkOut: toIsoDay(booking.checkOut),
      units: booking.units,
      totalCents: booking.totalCents,
      currency: booking.currency,
      expiresAt: booking.expiresAt,
      refundableUntil: booking.refundableUntil,
    };
  }

  private soldOut() {
    return new RpcException({
      status: HttpStatus.CONFLICT,
      message: 'No availability left for those dates',
    });
  }

  private outsideCalendar(message: string) {
    return new RpcException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      message,
    });
  }

  private isDuplicateKey(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private isRetryable(error: unknown) {
    if (error instanceof RpcException) {
      return false;
    }

    const message = error instanceof Error ? error.message : '';

    return (
      message.includes('40001') ||
      message.includes('40P01') ||
      message.includes('deadlock') ||
      message.includes('could not serialize')
    );
  }
}
