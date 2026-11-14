// Filter options and chip tones for the audit log (display only; the values are the stored slugs).
import type { StatusTone } from '../../../../components';

export const ACTION_OPTIONS = [
  'create',
  'update',
  'delete',
  'access',
  'login',
  'user_deactivated',
  'user_activated',
  'user_role_changed',
  'password_reset_requested',
  'invoice_status_paid',
  'invoice_status_void',
  'payment_reminder_sent',
  'dunning_reminder_sent',
  'feature_flag_enabled',
  'feature_flag_disabled',
  'ai_agent_status_active',
  'ai_agent_status_disabled',
  'bulk_notification_sent',
];

export const ENTITY_OPTIONS = [
  'user',
  'vacancy',
  'candidate',
  'organization',
  'role',
  'invoice',
  'subscription',
  'feature_flag',
  'ai_agent',
  'notification',
];

/** The chip tone carries the same meaning as the word in it (removal = danger, creation = success). */
export function actionTone(action: string): StatusTone {
  if (action === 'access') return 'neutral';
  if (action === 'login') return 'brand';
  if (['delete', 'void', 'deactivat', 'disabled'].some((k) => action.includes(k))) return 'danger';
  if (['create', 'paid', 'activat', 'enabled'].some((k) => action.includes(k))) return 'success';
  if (['update', 'change', 'reset'].some((k) => action.includes(k))) return 'info';
  return 'neutral';
}
