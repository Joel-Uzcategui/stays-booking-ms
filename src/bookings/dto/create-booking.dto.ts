import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateBookingDto {
  @IsUUID()
  userId: string;

  @IsUUID()
  roomTypeId: string;

  @IsISO8601({ strict: true })
  checkIn: string;

  @IsISO8601({ strict: true })
  checkOut: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  units?: number;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  idempotencyKey?: string;
}
