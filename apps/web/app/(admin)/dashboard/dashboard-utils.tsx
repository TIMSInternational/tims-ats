// Dashboard utility functions, types, and constants

export const PLAN_COLORS: Record<string, string> = {
  trial: '#F59E0B',
  starter: '#3B82F6',
  professional: '#8B5CF6',
  enterprise: '#10B981',
};

export const PLAN_BG_CLASSES: Record<string, string> = {
  trial: 'bg-amber-100 text-amber-800',
  starter: 'bg-blue-100 text-blue-800',
  professional: 'bg-violet-100 text-violet-800',
  enterprise: 'bg-emerald-100 text-emerald-800',
};

export const PLAN_LABELS: Record<string, string> = {
  trial: 'Trial',
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

export const HEALTH_CONFIG: Record<string, { dot: string; bg: string; label: string }> = {
  healthy: { dot: 'bg-emerald-500', bg: 'bg-emerald-50 border-emerald-200', label: 'Healthy' },
  at_risk: { dot: 'bg-amber-500', bg: 'bg-amber-50 border-amber-200', label: 'At Risk' },
  critical: { dot: 'bg-red-500', bg: 'bg-red-50 border-red-200', label: 'Critical' },
};

export const SEVERITY_CONFIG: Record<string, { dot: string; bg: string }> = {
  critical: { dot: 'bg-red-500', bg: 'bg-red-50' },
  warning: { dot: 'bg-amber-500', bg: 'bg-amber-50' },
  info: { dot: 'bg-blue-500', bg: 'bg-blue-50' },
};

export const BRAND_NAVY = '#1F114C';
export const BRAND_RED = '#DD0C15';

export function formatCurrency(value: number, compact?: boolean): string {
  if (compact && value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (compact && value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatCurrencyCOP(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M COP`;
  }
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function timeAgo(date: Date | string | null): string {
  if (!date) return 'Never';
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function trendArrow(current: number, previous: number): { label: string; color: string; up: boolean } {
  if (previous === 0) return { label: '+0%', color: 'text-muted', up: true };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct > 0) return { label: `+${pct}%`, color: 'text-emerald-600', up: true };
  if (pct < 0) return { label: `${pct}%`, color: 'text-red-600', up: false };
  return { label: '+0%', color: 'text-muted', up: true };
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} />;
}
