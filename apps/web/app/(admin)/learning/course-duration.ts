// The persisted Course.duration and the seeded catalog are measured in minutes.
export function courseHoursToMinutes(hours: number): number {
  return Math.round(hours * 60);
}

export function formatCourseDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes}m`;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}
