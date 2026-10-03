import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { BookingsService } from './bookings.service';

const SWEEP_BATCH = 100;

@Injectable()
export class HoldsService {
  private readonly logger = new Logger(HoldsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly outbox: OutboxService,
  ) {}

  @Cron('*/30 * * * * *')
  async sweep() {
    const expired = await this.prisma.booking.findMany({
      where: { status: 'held', expiresAt: { lt: new Date() } },
      orderBy: { expiresAt: 'asc' },
      take: SWEEP_BATCH,
    });

    if (expired.length === 0) {
      return;
    }

    let released = 0;
    let failed = 0;

    for (const booking of expired) {
      const claimed = await this.prisma
        .$transaction(async (tx) => {
          const result = await tx.booking.updateMany({
            where: { id: booking.id, status: 'held' },
            data: { status: 'expired' },
          });

          if (result.count === 0) {
            return false;
          }

          await this.bookings.release(tx, booking);

          await this.outbox.enqueue(tx, booking.id, 'booking.expired', {
            bookingId: booking.id,
            userId: booking.userId,
            roomTypeId: booking.roomTypeId,
          });

          return true;
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Could not expire ${booking.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          failed += 1;

          return false;
        });

      if (claimed) {
        released += 1;
      }
    }

    if (failed > 0) {
      this.logger.warn(`${failed} holds could not be expired`);
    }

    if (released > 0) {
      this.logger.log(`Expired ${released} holds`);
    }
  }
}
