const MS_PER_DAY = 86_400_000;

export const toUtcDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

export const nightsBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);

export const toIsoDay = (value: Date) => value.toISOString().slice(0, 10);

export const eachNight = (from: Date, to: Date) =>
  Array.from({ length: nightsBetween(from, to) }, (_, index) =>
    toIsoDay(new Date(from.getTime() + index * MS_PER_DAY)),
  );
