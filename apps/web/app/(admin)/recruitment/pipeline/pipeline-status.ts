// Application status badges for the pipeline list and table views (labels from i18n
// pipeline.applicationStatus, so neither view hard-codes "Activo" / "Rechazado").

const STATUS_CLASSES: Record<string, string> = {
  active: 'bg-blue-50 text-blue-600 border border-blue-200',
  rejected: 'bg-red-50 text-red-600 border border-red-200',
  withdrawn: 'bg-gray-100 text-gray-600',
  hired: 'bg-green-50 text-green-600 border border-green-200',
};

export function applicationStatusMap(labels: Record<string, string>): Record<string, { cls: string; label: string }> {
  return Object.fromEntries(
    Object.entries(STATUS_CLASSES).map(([status, cls]) => [status, { cls, label: labels[status] ?? status }]),
  );
}
