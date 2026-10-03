export interface CatalogRoomType {
  id: string;
  name: string;
  capacity: number;
  priceCents: number;
  currency: string;
  defaultUnits: number;
  updatedAt: string;
}

export interface HotelChangedEvent {
  id: string;
  active: boolean;
  updatedAt: string;
  roomTypes: CatalogRoomType[];
}

export const eventId = (event: HotelChangedEvent) =>
  `catalog.hotel.changed:${event.id}:${event.updatedAt}`;
