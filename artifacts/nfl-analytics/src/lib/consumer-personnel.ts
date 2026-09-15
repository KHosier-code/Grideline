type ConsumerPersonnelContext = {
  drivers: string[];
  message: string | null;
};

export function getConsumerPersonnelContent(context?: ConsumerPersonnelContext | null) {
  const drivers = context?.drivers.filter((driver) => driver.trim().length > 0) ?? [];
  return {
    drivers,
    message: drivers.length
      ? null
      : context?.message ?? "No supported personnel drivers are available for this matchup.",
  };
}