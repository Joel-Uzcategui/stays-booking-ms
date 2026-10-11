import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';

import { BookingsService } from './bookings.service';
import { ConfirmationsService } from './confirmations.service';
import type { PaymentSucceededEvent } from './confirmations.service';
import { CreateBookingDto, ListBookingsDto } from './dto';

@Controller()
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly confirmations: ConfirmationsService,
  ) {}

  @EventPattern('payment.succeeded')
  paymentSucceeded(@Payload() event: PaymentSucceededEvent) {
    return this.confirmations.apply(event);
  }

  @MessagePattern('booking.create')
  create(@Payload() dto: CreateBookingDto) {
    return this.bookingsService.create(dto);
  }

  @MessagePattern('booking.findOne')
  findOne(@Payload() payload: { id: string; userId: string }) {
    return this.bookingsService.findOne(payload.id, payload.userId);
  }

  @MessagePattern('booking.findMine')
  findMine(@Payload() dto: ListBookingsDto) {
    return this.bookingsService.findMine(
      dto.userId,
      dto.page,
      dto.limit,
      dto.group,
    );
  }

  @MessagePattern('booking.hold.extend')
  extendHold(@Payload() payload: { id: string; userId: string }) {
    return this.bookingsService.extendHold(payload.id, payload.userId);
  }

  @MessagePattern('booking.cancel')
  cancel(@Payload() payload: { id: string; userId: string }) {
    return this.bookingsService.cancel(payload.id, payload.userId);
  }
}
