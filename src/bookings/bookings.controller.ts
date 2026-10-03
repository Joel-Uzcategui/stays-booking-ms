import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

import { BookingsService } from './bookings.service';
import { CreateBookingDto, ListBookingsDto } from './dto';

@Controller()
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

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
    return this.bookingsService.findMine(dto.userId, dto.page, dto.limit);
  }

  @MessagePattern('booking.cancel')
  cancel(@Payload() payload: { id: string; userId: string }) {
    return this.bookingsService.cancel(payload.id, payload.userId);
  }
}
