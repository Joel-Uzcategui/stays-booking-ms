import { Module } from '@nestjs/common';

import { RoomTypesReplicaModule } from '../replica/room-types-replica.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [RoomTypesReplicaModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
