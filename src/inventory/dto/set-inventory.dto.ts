import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsUUID, Max, Min } from 'class-validator';

export class SetInventoryDto {
  @IsUUID()
  roomTypeId: string;

  @IsISO8601({ strict: true })
  from: string;

  @IsISO8601({ strict: true })
  to: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5000)
  totalUnits: number;
}
