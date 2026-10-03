import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';

import type { HotelChangedEvent } from './hotel-changed.event';
import { RoomTypesReplicaService } from './room-types-replica.service';

@Controller()
export class RoomTypesReplicaController {
  constructor(private readonly replica: RoomTypesReplicaService) {}

  @EventPattern('catalog.hotel.changed')
  changed(@Payload() event: HotelChangedEvent) {
    return this.replica.apply(event);
  }

  @MessagePattern('booking.replica.rebuild')
  rebuild() {
    return this.replica.rebuild();
  }
}
