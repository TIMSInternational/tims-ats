'use client';

import type { ReactNode } from 'react';

export function fmtCurrency(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function fmtDate(date: string | Date | null | undefined): string {
  if (!date) return '\u2014';
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
}

export function fmtDateLong(date: string | Date | null | undefined): string {
  if (!date) return '\u2014';
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(date));
}

export function Skeleton({ className }: { className: string }) {
  return <span className={`bg-gray-200 rounded animate-pulse block ${className}`} />;
}
