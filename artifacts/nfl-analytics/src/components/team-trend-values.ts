export const validTrendValue = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);