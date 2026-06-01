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

interface ToastOptions {
  type?: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
}

export function toast(message: string, options: ToastOptions = {}) {
  const { type = 'info', duration = 4000 } = options;
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
  el.textContent = message;
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
