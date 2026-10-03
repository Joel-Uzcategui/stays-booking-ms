import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { CATALOG_SERVICE } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { HotelChangedEvent, eventId } from './hotel-changed.event';

const WINDOW_DAYS = 365;
const REBUILD_PAGE_SIZE = 200;

interface CatalogRoomType {
  id: string;
  hotelId: string;
  name: string;
  capacity: number;
  priceCents: number;
  currency: string;
  defaultUnits: number;
  active: boolean;
  updatedAt: string;
}

@Injectable()
export class RoomTypesReplicaService {
  private readonly logger = new Logger(RoomTypesReplicaService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CATALOG_SERVICE) private readonly catalogClient: ClientProxy,
  ) {}

  async apply(event: HotelChangedEvent, options: { force?: boolean } = {}) {
    const id = eventId(event);

    if (!options.force) {
      const seen = await this.prisma.processedEvent.findUnique({
        where: { id },
      });

      if (seen) {
        return;
      }
    }

    const roomTypes = event.roomTypes ?? [];

    for (const roomType of roomTypes) {
      await this.upsert({
        ...roomType,
        hotelId: event.id,
        active: event.active,
      });

      if (event.active) {
        await this.ensureWindow(roomType.id, roomType.defaultUnits);
      }
    }

    await this.prisma.roomTypeReplica.updateMany({
      where: {
        hotelId: event.id,
        active: true,
        id: { notIn: roomTypes.map((roomType) => roomType.id) },
      },
      data: { active: false },
    });

    await this.prisma.processedEvent.upsert({
      where: { id },
      create: { id },
      update: {},
    });

    this.logger.log(`Applied ${id} with ${roomTypes.length} room types`);
  }

  async rebuild() {
    let page = 1;
    let hotels = 0;
    let roomTypes = 0;

    for (;;) {
      const batch = await firstValueFrom(
        this.catalogClient.send<HotelChangedEvent[]>(
          'catalog.hotel.findAllForIndex',
          { page, limit: REBUILD_PAGE_SIZE },
        ),
      );

      if (batch.length === 0) {
        break;
      }

      for (const hotel of batch) {
        await this.apply(hotel, { force: true });

        hotels += 1;
        roomTypes += hotel.roomTypes?.length ?? 0;
      }

      if (batch.length < REBUILD_PAGE_SIZE) {
        break;
      }

      page++;
    }

    this.logger.log(`Rebuilt replica with ${roomTypes} room types`);

    return { hotels, roomTypes };
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async extendWindow() {
    const roomTypes = await this.prisma.roomTypeReplica.findMany({
      where: { active: true },
      select: { id: true, defaultUnits: true },
    });

    for (const roomType of roomTypes) {
      await this.ensureWindow(roomType.id, roomType.defaultUnits);
    }

    this.logger.log(`Extended the calendar for ${roomTypes.length} room types`);
  }

  async ensureWindow(roomTypeId: string, totalUnits: number) {
    await this.prisma.$executeRaw`
      INSERT INTO inventory (room_type_id, date, total_units, reserved_units)
      SELECT ${roomTypeId}::uuid, day::date, ${totalUnits}, 0
      FROM generate_series(
        CURRENT_DATE,
        CURRENT_DATE + ${WINDOW_DAYS}::int,
        '1 day'
      ) AS day
      ON CONFLICT (room_type_id, date) DO NOTHING
    `;
  }

  async ensure(roomTypeId: string) {
    const known = await this.prisma.roomTypeReplica.findUnique({
      where: { id: roomTypeId },
    });

    if (known) {
      return known;
    }

    return this.pull(roomTypeId);
  }

  private async pull(roomTypeId: string) {
    const roomType = await firstValueFrom(
      this.catalogClient.send<CatalogRoomType>('catalog.roomType.findOne', {
        id: roomTypeId,
      }),
    ).catch(() => null);

    if (!roomType) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Room type ${roomTypeId} not found in catalog`,
      });
    }

    this.logger.log(`Pulled room type ${roomTypeId} from catalog`);

    return this.upsert(roomType);
  }

  private upsert(roomType: CatalogRoomType) {
    const data = {
      hotelId: roomType.hotelId,
      name: roomType.name,
      capacity: roomType.capacity,
      priceCents: roomType.priceCents,
      currency: roomType.currency,
      defaultUnits: roomType.defaultUnits,
      active: roomType.active,
      updatedAt: new Date(roomType.updatedAt),
    };

    return this.prisma.roomTypeReplica.upsert({
      where: { id: roomType.id },
      create: { id: roomType.id, ...data },
      update: data,
    });
  }
}
