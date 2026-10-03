import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { BookingsModule } from './bookings/bookings.module';
import { InventoryModule } from './inventory/inventory.module';
import { PrismaModule } from './prisma/prisma.module';
import { RoomTypesReplicaModule } from './replica/room-types-replica.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    InventoryModule,
    BookingsModule,
    RoomTypesReplicaModule,
  ],
})
export class AppModule {}
