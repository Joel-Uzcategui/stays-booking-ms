import { Module } from '@nestjs/common';

import { OutboxModule } from '../outbox/outbox.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ConfirmationsService } from './confirmations.service';
import { HoldsService } from './holds.service';

@Module({
  imports: [OutboxModule],
  controllers: [BookingsController],
  providers: [BookingsService, ConfirmationsService, HoldsService],
  exports: [BookingsService],
})
export class BookingsModule {}
