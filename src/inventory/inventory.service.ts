import { HttpStatus, Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

import { nightsBetween, toUtcDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { RoomTypesReplicaService } from '../replica/room-types-replica.service';
import { CheckAvailabilityDto, SetInventoryDto } from './dto';

const MAX_RANGE_NIGHTS = 400;
const BLOCKING_SAMPLE = 10;

interface AvailabilityRow {
  room_type_id: string;
  units_left: number;
  nights: number;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly replica: RoomTypesReplicaService,
  ) {}

  async set(dto: SetInventoryDto) {
    const from = toUtcDate(dto.from);
    const to = toUtcDate(dto.to);
    const nights = this.assertRange(from, to);

    await this.replica.ensure(dto.roomTypeId);
    await this.assertNotOversold(dto, from, to);

    await this.prisma.$executeRaw`
      INSERT INTO inventory (room_type_id, date, total_units, reserved_units)
      SELECT ${dto.roomTypeId}::uuid, day::date, ${dto.totalUnits}, 0
      FROM generate_series(${dto.from}::date, ${dto.to}::date - 1, '1 day') AS day
      ON CONFLICT (room_type_id, date)
      DO UPDATE SET total_units = EXCLUDED.total_units
    `.catch((error: unknown) => {
      if (this.isOverbookingError(error)) {
        throw new RpcException({
          status: HttpStatus.CONFLICT,
          message: 'Some nights already hold more units than the new total',
        });
      }

      throw error;
    });

    return {
      roomTypeId: dto.roomTypeId,
      from: dto.from,
      to: dto.to,
      nights,
      totalUnits: dto.totalUnits,
    };
  }

  async check(dto: CheckAvailabilityDto) {
    const checkIn = toUtcDate(dto.checkIn);
    const checkOut = toUtcDate(dto.checkOut);
    const nights = this.assertRange(checkIn, checkOut);

    const rooms = dto.rooms ?? 1;

    const roomTypes = await this.prisma.roomTypeReplica.findMany({
      where: {
        active: true,
        ...(dto.roomTypeId ? { id: dto.roomTypeId } : { hotelId: dto.hotelId }),
        ...(dto.guests
          ? { capacity: { gte: Math.ceil(dto.guests / rooms) } }
          : {}),
      },
      orderBy: { priceCents: 'asc' },
    });

    if (roomTypes.length === 0) {
      return [];
    }

    const rows = await this.prisma.$queryRaw<AvailabilityRow[]>`
      SELECT room_type_id,
             MIN(total_units - reserved_units)::int AS units_left,
             COUNT(*)::int AS nights
      FROM inventory
      WHERE room_type_id = ANY(${roomTypes.map((type) => type.id)}::uuid[])
        AND date >= ${dto.checkIn}::date
        AND date < ${dto.checkOut}::date
      GROUP BY room_type_id
      HAVING COUNT(*) = ${nights}
    `;

    const covered = new Map(rows.map((row) => [row.room_type_id, row]));

    return roomTypes.map((type) => ({
      roomTypeId: type.id,
      name: type.name,
      capacity: type.capacity,
      nights,
      rooms,
      sleeps: type.capacity * rooms,
      unitsLeft: Math.max(covered.get(type.id)?.units_left ?? 0, 0),
      priceCents: type.priceCents,
      currency: type.currency,
      totalPrice: type.priceCents * nights * rooms,
    }));
  }

  private assertRange(from: Date, to: Date) {
    const nights = nightsBetween(from, to);

    if (Number.isNaN(nights) || nights < 1) {
      throw new RpcException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: 'The end date must be after the start date',
      });
    }

    if (nights > MAX_RANGE_NIGHTS) {
      throw new RpcException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: `The range cannot exceed ${MAX_RANGE_NIGHTS} nights`,
      });
    }

    return nights;
  }

  private async assertNotOversold(dto: SetInventoryDto, from: Date, to: Date) {
    const blocking = await this.prisma.inventory.findMany({
      where: {
        roomTypeId: dto.roomTypeId,
        date: { gte: from, lt: to },
        reservedUnits: { gt: dto.totalUnits },
      },
      select: { date: true, reservedUnits: true },
      orderBy: { date: 'asc' },
      take: BLOCKING_SAMPLE,
    });

    if (blocking.length === 0) {
      return;
    }

    const detail = blocking
      .map(
        (night) =>
          `${night.date.toISOString().slice(0, 10)} holds ${night.reservedUnits}`,
      )
      .join(', ');

    throw new RpcException({
      status: HttpStatus.CONFLICT,
      message: `Cannot lower to ${dto.totalUnits} units: ${detail}`,
    });
  }

  private isOverbookingError(error: unknown) {
    return error instanceof Error && error.message.includes('no_overbooking');
  }
}
