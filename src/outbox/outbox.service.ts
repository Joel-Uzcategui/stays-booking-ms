import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { reasonOf } from '../common/reason';
import {
  EVENTS_PUBLISHER,
  NOTIFICATION_SERVICE,
  PAYMENT_SERVICE,
} from '../config';
import { Outbox, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const BATCH = 100;
const TRANSACTION_TIMEOUT = 60_000;

const ROUTES: Record<string, string[]> = {
  'payment.refund.requested': [PAYMENT_SERVICE],
  'booking.confirmed': [NOTIFICATION_SERVICE],
};

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: ClientProxy,
    @Inject(PAYMENT_SERVICE) private readonly payments: ClientProxy,
    @Inject(NOTIFICATION_SERVICE) private readonly notifications: ClientProxy,
  ) {}

  private client(name: string) {
    return name === PAYMENT_SERVICE ? this.payments : this.notifications;
  }

  enqueue(
    tx: Prisma.TransactionClient,
    aggregateId: string,
    eventType: string,
    payload: Prisma.InputJsonValue,
  ) {
    return tx.outbox.create({ data: { aggregateId, eventType, payload } });
  }

  @Cron('*/5 * * * * *')
  async publish() {
    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.$queryRaw<{ id: bigint }[]>`
          SELECT id FROM outbox
          WHERE published_at IS NULL
          ORDER BY id ASC
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED
        `;

        if (claimed.length === 0) {
          return;
        }

        const pending = await tx.outbox.findMany({
          where: { id: { in: claimed.map((row) => row.id) } },
          orderBy: { id: 'asc' },
        });

        await this.send(tx, pending);
      },
      { timeout: TRANSACTION_TIMEOUT },
    );
  }

  private async send(tx: Prisma.TransactionClient, pending: Outbox[]) {
    let sent = 0;

    for (const row of pending) {
      try {
        const targets = ROUTES[row.eventType];

        if (targets) {
          for (const target of targets) {
            await firstValueFrom(
              this.client(target).emit(row.eventType, row.payload),
            );
          }
        } else {
          await firstValueFrom(this.publisher.emit(row.eventType, row.payload));
        }
      } catch (error) {
        this.logger.warn(
          `Could not publish ${row.eventType} for ${row.aggregateId}: ${reasonOf(error)}`,
        );
        break;
      }

      await tx.outbox.update({
        where: { id: row.id },
        data: { publishedAt: new Date() },
      });

      sent += 1;
    }

    if (sent > 0) {
      this.logger.log(`Published ${sent} events`);
    }
  }
}
