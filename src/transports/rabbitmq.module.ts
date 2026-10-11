import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import {
  CATALOG_SERVICE,
  EVENTS_PUBLISHER,
  PAYMENT_SERVICE,
  envs,
} from '../config';

const clients = ClientsModule.register([
  {
    name: CATALOG_SERVICE,
    transport: Transport.RMQ,
    options: {
      urls: [envs.rabbitmqUrl],
      queue: envs.catalogQueue,
      queueOptions: { durable: true },
    },
  },
  {
    name: PAYMENT_SERVICE,
    transport: Transport.RMQ,
    options: {
      urls: [envs.rabbitmqUrl],
      queue: envs.paymentQueue,
      queueOptions: { durable: true },
    },
  },
  {
    name: EVENTS_PUBLISHER,
    transport: Transport.RMQ,
    options: {
      urls: [envs.rabbitmqUrl],
      queue: envs.bookingEventsQueue,
      queueOptions: { durable: true },
    },
  },
]);

@Module({
  imports: [clients],
  exports: [clients],
})
export class RabbitMQModule {}
