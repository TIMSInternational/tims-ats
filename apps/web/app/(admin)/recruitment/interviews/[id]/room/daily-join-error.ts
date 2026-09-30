// ---------------------------------------------------------------------------
// Classifies a Daily join failure into a user-facing CATEGORY. The raw Daily
// message (URLs, bundle names, CSP text, token details) is never shown — only
// the category's i18n copy. Input is whatever `daily.join()` rejected with, or
// the payload of Daily's fatal `error` event, so it is typed `unknown`.
// ---------------------------------------------------------------------------

export const DAILY_JOIN_ERROR_CATEGORIES = ['blocked', 'expired', 'unavailable', 'network', 'unknown'] as const;
export type DailyJoinErrorCategory = (typeof DAILY_JOIN_ERROR_CATEGORIES)[number];

const EXPIRED_TYPES = new Set(['exp-room', 'exp-token', 'nbf-room', 'nbf-token']);
const UNAVAILABLE_TYPES = new Set(['no-room', 'meeting-full', 'end-of-life', 'not-allowed', 'ejected']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

export function classifyDailyJoinError(error: unknown): DailyJoinErrorCategory {
  const root = asRecord(error);
  // The `error` event nests the typed object under `.error`; a join rejection may be it directly.
  const typed = asRecord(root?.error) ?? root;
  const type = stringField(typed, 'type');
  const details = asRecord(typed?.details);
  const on = stringField(details, 'on');

  if (type && EXPIRED_TYPES.has(type)) return 'expired';
  if (type && UNAVAILABLE_TYPES.has(type)) return 'unavailable';
  if (type === 'connection-error') return on === 'load' ? 'blocked' : 'network';

  const name = stringField(root, 'name');
  const message = [
    typeof error === 'string' ? error : null,
    stringField(root, 'message'),
    stringField(root, 'errorMsg'),
    stringField(typed, 'msg'),
  ]
    .filter((m): m is string => m !== null)
    .join(' ')
    .toLowerCase();

  // The call-machine bundle failing to load/evaluate (e.g. a Content-Security-Policy
  // without 'unsafe-eval' surfaces as EvalError) — the browser blocked the component.
  if (name === 'EvalError' || /unsafe-eval|content security policy|failed to load|load-attempt|bundle/.test(message)) {
    return 'blocked';
  }
  if (/expired|exp-token|nbf/.test(message)) return 'expired';
  if (/network|websocket|timed? ?out|connection/.test(message)) return 'network';
  return 'unknown';
}
