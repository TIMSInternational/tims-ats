'use client';

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const avatarColors = [
  'bg-[#1F114C]', 'bg-blue-500', 'bg-violet-500', 'bg-amber-500',
  'bg-rose-500', 'bg-teal-500', 'bg-cyan-500', 'bg-emerald-600',
  'bg-indigo-500', 'bg-orange-500', 'bg-pink-500',
];

export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

export function planBadge(plan: string) {
  const styles: Record<string, string> = {
    enterprise: 'bg-emerald-100 text-emerald-700',
    professional: 'bg-violet-100 text-violet-700',
    starter: 'bg-blue-100 text-blue-700',
    trial: 'bg-amber-100 text-amber-700',
  };
  const cls = styles[plan?.toLowerCase()] || 'bg-gray-100 text-gray-700';
  return (
    <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${cls}`}>
      {plan?.charAt(0).toUpperCase() + plan?.slice(1)}
    </span>
  );
}

export function statusDot(status: string, isActive?: boolean, labels?: { active: string; suspended: string }) {
  const l = labels || { active: 'Activa', suspended: 'Suspendida' };
  const isSuspended = !isActive || status?.toLowerCase() === 'suspended';
  const dotColor = isSuspended ? 'bg-[#DD0C15]' : 'bg-green-400';
  const textColor = isSuspended ? 'text-[#DD0C15] font-medium' : 'text-[#585858]';
  const label = isSuspended ? l.suspended : l.active;
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span className={`text-xs ${textColor}`}>{label}</span>
    </div>
  );
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '\u2014';
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
}

export function trialDateColor(trialEndsAt: string | Date | null | undefined): string {
  if (!trialEndsAt) return 'text-[#8B8B8B]';
  const daysLeft = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 3) return 'text-[#DD0C15] font-medium';
  if (daysLeft <= 7) return 'text-amber-600 font-medium';
  return 'text-[#8B8B8B]';
}

export function Skeleton({ className }: { className: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

export function SkeletonRow() {
  return (
    <tr className="border-b border-[#F6F6F6] animate-pulse">
      <td className="px-3 py-3.5"><div className="w-4 h-4 bg-gray-200 rounded" /></td>
      <td className="px-5 py-3.5"><div className="flex items-center gap-3"><div className="w-8 h-8 rounded-lg bg-gray-200" /><div className="h-4 w-32 bg-gray-200 rounded" /></div></td>
      <td className="px-4 py-3.5"><div className="h-5 w-16 bg-gray-100 rounded-full" /></td>
      <td className="px-4 py-3.5"><div className="h-3 w-14 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3.5"><div className="h-3 w-6 bg-gray-100 rounded mx-auto" /></td>
      <td className="px-4 py-3.5 text-center"><div className="h-4 w-6 bg-gray-100 rounded mx-auto" /></td>
      <td className="px-4 py-3.5 text-center"><div className="h-4 w-8 bg-gray-100 rounded mx-auto" /></td>
      <td className="px-4 py-3.5"><div className="h-3 w-20 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3.5"><div className="h-5 w-6 bg-gray-100 rounded mx-auto" /></td>
    </tr>
  );
}

export function formatRelativeTime(date: string | Date | null | undefined): string {
  if (!date) return '';
  const now = Date.now();
  const d = new Date(date).getTime();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'Ahora';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 30) return `${diffDays}d`;
  return `${Math.floor(diffDays / 30)}mo`;
}
