'use client';

// Lightweight toast system — no dependencies
// Renders a fixed-position notification that auto-dismisses

let toastContainer: HTMLDivElement | null = null;

function getContainer(): HTMLDivElement {
  if (toastContainer) return toastContainer;
  toastContainer = document.createElement('div');
  toastContainer.id = 'toast-container';
  toastContainer.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
  document.body.appendChild(toastContainer);
  return toastContainer;
}

interface ToastAction {
  label: string;
  href: string;
}

interface ToastOptions {
  type?: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  /**
   * Optional clickable action rendered below the message (e.g. a proactive
   * "next step" suggestion after a pipeline stage move). Strictly additive —
   * omitting it preserves today's exact plain-message toast, so every
   * existing bare `toast(message, options)` call keeps working unchanged.
   * `label`/`href` are always internal strings (i18n copy + app routes),
   * never raw user input, but construction stays explicit createElement-based
   * (no innerHTML) to match this file's existing vanilla-DOM style.
   */
  action?: ToastAction;
}

export function toast(message: string, options: ToastOptions = {}) {
  const { type = 'info', duration = 4000, action } = options;
  const container = getContainer();

  const colors = {
    success: { bg: '#ecfdf5', border: '#6ee7b7', text: '#065f46' },
    error: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b' },
    warning: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e' },
    info: { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af' },
  };
  const c = colors[type];

  const el = document.createElement('div');
  el.style.cssText = `background:${c.bg};border:1px solid ${c.border};color:${c.text};padding:12px 16px;border-radius:10px;font-size:13px;font-family:inherit;box-shadow:0 4px 12px rgba(0,0,0,0.1);pointer-events:auto;animation:slideIn 0.2s ease;max-width:360px;`;

  const messageEl = document.createElement('span');
  messageEl.style.cssText = 'display:block;';
  messageEl.textContent = message;
  el.appendChild(messageEl);

  if (action) {
    const link = document.createElement('a');
    link.href = action.href;
    link.textContent = action.label;
    link.style.cssText = `display:inline-block;margin-top:6px;color:${c.text};font-weight:600;text-decoration:underline;cursor:pointer;`;
    el.appendChild(link);
  }

  container.appendChild(el);

  // Add animation keyframes if not already added
  if (!document.getElementById('toast-keyframes')) {
    const style = document.createElement('style');
    style.id = 'toast-keyframes';
    style.textContent = '@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideOut{from{opacity:1}to{opacity:0;transform:translateX(50%)}}';
    document.head.appendChild(style);
  }

  setTimeout(() => {
    el.style.animation = 'slideOut 0.2s ease forwards';
    setTimeout(() => el.remove(), 200);
  }, duration);
}
