'use client';

import { localizeKnownErrorCode } from './known-error-codes';
import es from './i18n/es.json';
import en from './i18n/en.json';

// Lightweight toast system — no dependencies (foundation-spec.md §14). Prefer inline feedback; use a toast
// only after a significant action ("Candidato movido a Entrevista"). Success and info toasts dismiss after
// 5 s; a toast with an action, and every error, stays until dismissed (accessibility.md › Cognitive:
// "Minimize use of time-boxed interface elements"). Styling is Tailwind classes, not inline styles.

const POLITE_ID = 'toast-container';
const ALERT_ID = 'toast-alerts';

// Top-right on desktop; under the top bar, full width, on phones.
const CONTAINER_CLASSES =
  'pointer-events-none fixed inset-x-4 top-14 z-[9999] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-4 sm:top-4 sm:w-[360px]';

const TONE_CLASSES = {
  success: 'border-success/30 bg-success-bg text-success',
  error: 'border-danger/30 bg-danger-bg text-danger',
  warning: 'border-warning/30 bg-warning-bg text-warning',
  info: 'border-info/30 bg-info-bg text-info',
} as const;

function getContainer(alert: boolean): HTMLDivElement {
  const id = alert ? ALERT_ID : POLITE_ID;
  const existing = document.getElementById(id);
  if (existing instanceof HTMLDivElement) return existing;
  const container = document.createElement('div');
  container.id = id;
  // Live regions, so screen readers announce each toast as it appears: errors interrupt (alert), the rest
  // wait their turn (status).
  container.setAttribute('role', alert ? 'alert' : 'status');
  container.setAttribute('aria-live', alert ? 'assertive' : 'polite');
  container.className = CONTAINER_CLASSES;
  document.body.appendChild(container);
  return container;
}

/** The close label in the page's language (the toast lives outside React, so it reads <html lang>). */
function closeLabel(): string {
  return document.documentElement.lang === 'en' ? en.common.close : es.common.close;
}

interface ToastAction {
  label: string;
  href: string;
}

interface ToastOptions {
  type?: 'success' | 'error' | 'warning' | 'info';
  /** Auto-dismiss delay for success / info / warning toasts without an action. Default 5000 ms. */
  duration?: number;
  /**
   * Optional clickable action rendered below the message (e.g. a proactive "next step" suggestion after a
   * pipeline stage move). A toast with an action stays until dismissed, so the action is never lost.
   * `label`/`href` are always internal strings (i18n copy + app routes), never raw user input, and
   * construction stays explicit createElement-based (no innerHTML).
   */
  action?: ToastAction;
}

export function toast(message: string, options: ToastOptions = {}) {
  const { type = 'info', duration = 5000, action } = options;
  message = localizeKnownErrorCode(message);
  const persistent = type === 'error' || action !== undefined;
  const container = getContainer(type === 'error');

  const el = document.createElement('div');
  el.className = `pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-body shadow-popover animate-sheet-up ${TONE_CLASSES[type]}`;

  const body = document.createElement('div');
  body.className = 'min-w-0 flex-1';
  const messageEl = document.createElement('span');
  messageEl.className = 'block text-primary';
  messageEl.textContent = message;
  body.appendChild(messageEl);

  if (action) {
    const link = document.createElement('a');
    link.href = action.href;
    link.textContent = action.label;
    link.className = 'mt-1.5 inline-block font-semibold underline underline-offset-2';
    body.appendChild(link);
  }
  el.appendChild(body);

  const dismiss = () => {
    el.classList.add('opacity-0', 'transition-opacity', 'duration-200');
    setTimeout(() => el.remove(), 200);
  };

  if (persistent) {
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', closeLabel());
    close.className =
      '-mr-1 -mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-black/5 pointer-coarse:size-11';
    close.textContent = '×';
    close.addEventListener('click', dismiss);
    el.appendChild(close);
  }

  container.appendChild(el);
  if (!persistent) setTimeout(dismiss, duration);
}
