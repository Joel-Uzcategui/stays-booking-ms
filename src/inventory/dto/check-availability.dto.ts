import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class CheckAvailabilityDto {
  @ValidateIf((dto: CheckAvailabilityDto) => !dto.roomTypeId)
  @IsUUID()
  hotelId?: string;

  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  @IsISO8601({ strict: true })
  checkIn: string;

  @IsISO8601({ strict: true })
  checkOut: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  rooms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(40)
  guests?: number;
}
