import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

import { CheckAvailabilityDto, SetInventoryDto } from './dto';
import { InventoryService } from './inventory.service';

@Controller()
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @MessagePattern('booking.inventory.set')
  set(@Payload() dto: SetInventoryDto) {
    return this.inventoryService.set(dto);
  }

  @MessagePattern('booking.availability.check')
  check(@Payload() dto: CheckAvailabilityDto) {
    return this.inventoryService.check(dto);
  }
}
