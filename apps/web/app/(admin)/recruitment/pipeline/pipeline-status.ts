// Application status badges for the pipeline list and table views (labels from i18n
// pipeline.applicationStatus, so neither view hard-codes "Activo" / "Rechazado"). Foundation StatusBadge
// tones: every pair passes 4.5:1 at 11px, and each carries an outcome icon, never colour alone.
import type { StatusMapEntry, StatusTone } from '../../../../components';

const STATUS_TONES: Record<string, StatusTone> = {
  active: 'info',
  rejected: 'danger',
  withdrawn: 'neutral',
  hired: 'success',
};

export function applicationStatusMap(labels: Record<string, string>): Record<string, StatusMapEntry> {
  return Object.fromEntries(
    Object.entries(STATUS_TONES).map(([status, tone]) => [status, { tone, label: labels[status] ?? status }]),
  );
}
