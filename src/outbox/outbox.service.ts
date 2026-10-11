import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { EVENTS_PUBLISHER, PAYMENT_SERVICE } from '../config';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const BATCH = 100;

const PAYMENT_EVENTS = ['payment.refund.requested'];

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: ClientProxy,
    @Inject(PAYMENT_SERVICE) private readonly payments: ClientProxy,
  ) {}

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
    const pending = await this.prisma.outbox.findMany({
      where: { publishedAt: null },
      orderBy: { id: 'asc' },
      take: BATCH,
    });

    if (pending.length === 0) {
      return;
    }

    let sent = 0;

    for (const row of pending) {
      try {
        const client = PAYMENT_EVENTS.includes(row.eventType)
          ? this.payments
          : this.publisher;

        await firstValueFrom(client.emit(row.eventType, row.payload));
      } catch (error) {
        this.logger.warn(
          `Could not publish ${row.eventType} for ${row.aggregateId}: ${String(error)}`,
        );
        break;
      }

      await this.prisma.outbox.update({
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
