'use client';

export const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  platform_owner: { bg: 'bg-purple-100', text: 'text-purple-700' },
  super_admin: { bg: 'bg-red-100', text: 'text-red-700' },
  hr_admin: { bg: 'bg-blue-100', text: 'text-blue-700' },
  recruiter: { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  leader: { bg: 'bg-amber-100', text: 'text-amber-700' },
  employee: { bg: 'bg-gray-100', text: 'text-gray-500' },
};

const AVATAR_COLORS = [
  'bg-[#DD0C15]', 'bg-[#1F114C]', 'bg-blue-500', 'bg-emerald-500',
  'bg-orange-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500',
  'bg-violet-500', 'bg-amber-500',
];

export function getInitials(firstName?: string | null, lastName?: string | null): string {
  return `${(firstName || '')[0] || ''}${(lastName || '')[0] || ''}`.toUpperCase();
}

export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-';
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
}

export function formatLastLogin(date: string | Date | null | undefined): string {
  if (!date) return 'Nunca';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Hace un momento';
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours} hora${hours > 1 ? 's' : ''}`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Ayer';
  if (days < 30) return `Hace ${days} dias`;
  return formatDate(date);
}

export function SkeletonRow() {
  return (
    <tr className="border-b border-[#F3F3F3] animate-pulse">
      <td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-full bg-gray-200" /><div className="h-4 w-28 bg-gray-200 rounded" /></div></td>
      <td className="px-4 py-2.5"><div className="h-3 w-36 bg-gray-100 rounded" /></td>
      <td className="px-4 py-2.5"><div className="h-3 w-24 bg-gray-100 rounded" /></td>
      <td className="px-4 py-2.5"><div className="h-5 w-16 bg-gray-100 rounded-full" /></td>
      <td className="px-4 py-2.5"><div className="h-3 w-14 bg-gray-100 rounded" /></td>
      <td className="px-4 py-2.5"><div className="h-3 w-20 bg-gray-100 rounded" /></td>
      <td className="px-4 py-2.5"><div className="h-3 w-20 bg-gray-100 rounded" /></td>
      <td className="px-4 py-2.5"><div className="h-5 w-28 bg-gray-100 rounded" /></td>
    </tr>
  );
}
