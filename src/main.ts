import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

import { AppModule } from './app.module';
import { envs } from './config';
import { rpcValidationPipe } from './common/rpc-validation.pipe';

async function bootstrap() {
  const logger = new Logger('BookingMS');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [envs.rabbitmqUrl],
        queue: envs.rabbitmqQueue,
        queueOptions: { durable: true },
      },
    },
  );

  app.useGlobalPipes(rpcValidationPipe());

  await app.listen();
  logger.log(`Booking microservice listening on queue "${envs.rabbitmqQueue}"`);
}

void bootstrap();
