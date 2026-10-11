import { Injectable, Logger } from '@nestjs/common';

import { envs } from '../config';
import { Prisma } from '../generated/prisma/client';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { BookingsService } from './bookings.service';

const MS_PER_DAY = 86_400_000;

export interface PaymentSucceededEvent {
  paymentId: string;
  bookingId: string;
  userId: string;
  amountCents: number;
  currency: string;
}

@Injectable()
export class ConfirmationsService {
  private readonly logger = new Logger(ConfirmationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly outbox: OutboxService,
  ) {}

  async apply(event: PaymentSucceededEvent) {
    const id = `payment.succeeded:${event.paymentId}`;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.processedEvent.create({ data: { id } });

        const booking = await tx.booking.findUnique({
          where: { id: event.bookingId },
        });

        if (!booking) {
          await this.requestRefund(tx, event, 'booking not found');

          return;
        }

        if (booking.status !== 'held') {
          const recovered =
            booking.status === 'expired' &&
            (await this.bookings.reacquire(tx, booking));

          if (!recovered) {
            await this.requestRefund(tx, event, `booking is ${booking.status}`);

            return;
          }

          this.logger.warn(
            `Booking ${booking.id} had expired but the rooms were still free: recovered`,
          );
        }

        const claimed = await tx.booking.updateMany({
          where: { id: booking.id, status: booking.status },
          data: {
            status: 'confirmed',
            expiresAt: null,
            refundableUntil: this.refundableUntil(booking.checkIn),
          },
        });

        if (claimed.count === 0) {
          return;
        }

        await this.outbox.enqueue(tx, booking.id, 'booking.confirmed', {
          bookingId: booking.id,
          userId: booking.userId,
          paymentId: event.paymentId,
        });

        this.logger.log(
          `Booking ${booking.id} confirmed by payment ${event.paymentId}`,
        );
      });
    } catch (error) {
      if (!this.isDuplicateKey(error)) {
        throw error;
      }

      this.logger.log(`Event ${id} was already processed`);
    }
  }

  private async requestRefund(
    tx: Prisma.TransactionClient,
    event: PaymentSucceededEvent,
    reason: string,
  ) {
    await this.outbox.enqueue(tx, event.bookingId, 'payment.refund.requested', {
      paymentId: event.paymentId,
      bookingId: event.bookingId,
      userId: event.userId,
      reason,
    });

    this.logger.error(
      `Payment ${event.paymentId} succeeded but ${reason}: refunding ${event.amountCents} ${event.currency}`,
    );
  }

  private refundableUntil(checkIn: Date) {
    return new Date(checkIn.getTime() - envs.refundWindowDays * MS_PER_DAY);
  }

  private isDuplicateKey(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
