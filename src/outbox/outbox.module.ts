import { Module } from '@nestjs/common';

import { RabbitMQModule } from '../transports/rabbitmq.module';
import { OutboxService } from './outbox.service';

@Module({
  imports: [RabbitMQModule],
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
