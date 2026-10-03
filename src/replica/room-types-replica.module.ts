import { Module } from '@nestjs/common';

import { RabbitMQModule } from '../transports/rabbitmq.module';
import { RoomTypesReplicaController } from './room-types-replica.controller';
import { RoomTypesReplicaService } from './room-types-replica.service';

@Module({
  imports: [RabbitMQModule],
  controllers: [RoomTypesReplicaController],
  providers: [RoomTypesReplicaService],
  exports: [RoomTypesReplicaService],
})
export class RoomTypesReplicaModule {}
