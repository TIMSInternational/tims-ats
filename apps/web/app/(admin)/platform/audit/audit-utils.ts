export const ACTION_OPTIONS = ['', 'create', 'update', 'delete', 'access', 'login'] as const;
export const ENTITY_OPTIONS = ['', 'user', 'vacancy', 'candidate', 'organization', 'role'] as const;

export const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  create: { bg: 'bg-green-100', text: 'text-green-700' },
  update: { bg: 'bg-blue-100', text: 'text-blue-700' },
  delete: { bg: 'bg-red-100', text: 'text-red-700' },
  access: { bg: 'bg-gray-100', text: 'text-gray-600' },
  login: { bg: 'bg-purple-100', text: 'text-purple-700' },
};

const AVATAR_COLORS = [
  { bg: 'bg-blue-100', text: 'text-blue-600' },
  { bg: 'bg-green-100', text: 'text-green-600' },
  { bg: 'bg-orange-100', text: 'text-orange-600' },
  { bg: 'bg-red-100', text: 'text-red-600' },
  { bg: 'bg-purple-100', text: 'text-purple-600' },
  { bg: 'bg-teal-100', text: 'text-teal-600' },
  { bg: 'bg-pink-100', text: 'text-pink-600' },
  { bg: 'bg-indigo-100', text: 'text-indigo-600' },
];

export function getInitials(name?: string | null): string {
  if (!name) return '??';
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function getAvatarColor(name?: string | null) {
  if (!name) return AVATAR_COLORS[0];
  const idx = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

export function formatTimestamp(ts: string | Date) {
  const d = new Date(ts);
  const day = d.getDate();
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const mon = months[d.getMonth()];
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${day} ${mon} ${h}:${m}:${s}`;
}
