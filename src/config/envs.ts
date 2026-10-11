import 'dotenv/config';
import * as joi from 'joi';

interface EnvVars {
  DATABASE_URL: string;
  RABBITMQ_URL: string;
  RABBITMQ_QUEUE: string;
  CATALOG_QUEUE: string;
  BOOKING_EVENTS_QUEUE: string;
  PAYMENT_QUEUE: string;
  HOLD_TTL_MINUTES: number;
  PAYMENT_WINDOW_MINUTES: number;
  REFUND_WINDOW_DAYS: number;
  BOOKING_STRATEGY: 'naive' | 'atomic';
}

const envsSchema = joi
  .object({
    DATABASE_URL: joi.string().required(),
    RABBITMQ_URL: joi.string().required(),
    RABBITMQ_QUEUE: joi.string().required(),
    CATALOG_QUEUE: joi.string().required(),
    BOOKING_EVENTS_QUEUE: joi.string().default('booking_events'),
    PAYMENT_QUEUE: joi.string().default('payment_queue'),
    HOLD_TTL_MINUTES: joi.number().integer().min(1).default(15),
    PAYMENT_WINDOW_MINUTES: joi.number().integer().min(1).default(15),
    REFUND_WINDOW_DAYS: joi.number().integer().min(0).default(2),
    BOOKING_STRATEGY: joi.string().valid('naive', 'atomic').default('atomic'),
  })
  .unknown(true);

const result = envsSchema.validate(process.env) as {
  error?: joi.ValidationError;
  value: EnvVars;
};

if (result.error) {
  throw new Error(`Config validation error: ${result.error.message}`);
}

const envVars = result.value;

export const envs = {
  databaseUrl: envVars.DATABASE_URL,
  rabbitmqUrl: envVars.RABBITMQ_URL,
  rabbitmqQueue: envVars.RABBITMQ_QUEUE,
  catalogQueue: envVars.CATALOG_QUEUE,
  bookingEventsQueue: envVars.BOOKING_EVENTS_QUEUE,
  paymentQueue: envVars.PAYMENT_QUEUE,
  holdTtlMinutes: envVars.HOLD_TTL_MINUTES,
  paymentWindowMinutes: envVars.PAYMENT_WINDOW_MINUTES,
  refundWindowDays: envVars.REFUND_WINDOW_DAYS,
  bookingStrategy: envVars.BOOKING_STRATEGY,
};
