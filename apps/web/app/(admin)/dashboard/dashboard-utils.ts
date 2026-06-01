export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(value);
}

export function timeAgo(timestamp: string | Date): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Ahora';
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours}h`;
  return `Hace ${Math.floor(hours / 24)}d`;
}

export function getActivityDotColor(type: string): string {
  switch (type) {
    case 'org_created': return 'bg-green-400';
    case 'user_created': return 'bg-purple-400';
    case 'platform_owner': return 'bg-blue-400';
    case 'payment_failed': return 'bg-[#DD0C15]';
    case 'plan_upgrade': return 'bg-blue-400';
    case 'trial_expiring': return 'bg-amber-400';
    case 'bulk_users': return 'bg-blue-400';
    case 'onboarding_complete': return 'bg-green-400';
    default: return 'bg-gray-400';
  }
}

export function getActivityIconColor(type: string): string {
  switch (type) {
    case 'org_created': return 'text-green-400';
    case 'user_created': return 'text-purple-400';
    case 'platform_owner': return 'text-blue-400';
    case 'payment_failed': return 'text-[#DD0C15]';
    case 'plan_upgrade': return 'text-blue-400';
    case 'trial_expiring': return 'text-amber-400';
    case 'bulk_users': return 'text-blue-400';
    case 'onboarding_complete': return 'text-green-400';
    default: return 'text-gray-400';
  }
}

export function mapNotifType(type: string): 'critical' | 'warning' | 'info' {
  if (type === 'critical') return 'critical';
  if (type === 'warning') return 'warning';
  return 'info';
}

export function getAlertStyles(severity: 'critical' | 'warning' | 'info') {
  switch (severity) {
    case 'critical':
      return { bg: 'bg-red-50', badge: 'text-red-700 bg-red-100', label: 'Critico' };
    case 'warning':
      return { bg: 'bg-amber-50', badge: 'text-amber-700 bg-amber-100', label: 'Warning' };
    case 'info':
      return { bg: 'bg-blue-50', badge: 'text-blue-700 bg-blue-100', label: 'Info' };
  }
}

export const PLAN_COLORS: Record<string, string> = {
  trial: '#F59E0B',
  starter: '#3B82F6',
  professional: '#8B5CF6',
  enterprise: '#10B981',
};

export const PLAN_DOT_CLASSES: Record<string, string> = {
  trial: 'bg-amber-400',
  starter: 'bg-blue-500',
  professional: 'bg-violet-500',
  enterprise: 'bg-emerald-500',
};

export const PLAN_LABELS: Record<string, string> = {
  trial: 'Trial',
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

export const BAR_OPACITIES = [
  'bg-[#1F114C]/15',
  'bg-[#1F114C]/20',
  'bg-[#1F114C]/25',
  'bg-[#1F114C]/35',
  'bg-[#1F114C]/50',
  'bg-[#1F114C]',
];
