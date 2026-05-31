'use client';

import { useState, useMemo } from 'react';
import { trpc } from '../../../../lib/trpc';

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
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

function getInitials(firstName?: string | null, lastName?: string | null): string {
  return `${(firstName || '')[0] || ''}${(lastName || '')[0] || ''}`.toUpperCase();
}

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-';
  const d = new Date(date);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatLastLogin(date: string | Date | null | undefined): string {
  if (!date) return 'Nunca';
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
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

export default function PlatformUsersPage() {
  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<'active' | 'all'>('active');

  const { data, isLoading } = trpc.platform.listAllUsers.useQuery({
    search: search || undefined,
    organizationId: orgFilter || undefined,
    isActive: activeFilter === 'active' ? true : undefined,
    limit: 50,
  });

  const users = data?.users ?? [];
  const total = data?.total ?? 0;

  // Compute KPIs from data
  const { data: allUsersData } = trpc.platform.listAllUsers.useQuery({ limit: 50 });
  const allUsers = allUsersData?.users ?? [];
  const totalAll = allUsersData?.total ?? 0;

  const kpis = useMemo(() => {
    const now = new Date();
    const todayCutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const activeToday = allUsers.filter(u => u.lastLoginAt && new Date(u.lastLoginAt) >= todayCutoff).length;
    const platformOwners = allUsers.filter(u => u.isPlatformOwner).length;
    const inactive = allUsers.filter(u => !u.isActive).length;
    return { totalAll, activeToday, platformOwners, inactive };
  }, [allUsers, totalAll]);

  // Extract unique orgs for filter dropdown
  const orgOptions = useMemo(() => {
    const map = new Map<string, string>();
    allUsers.forEach(u => {
      if (u.organization) map.set(u.organization.id, u.organization.name);
    });
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [allUsers]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-5">
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center animate-pulse">
              <div className="h-3 bg-gray-200 rounded w-20 mx-auto mb-2" />
              <div className="h-8 bg-gray-200 rounded w-16 mx-auto mb-1" />
              <div className="h-2.5 bg-gray-100 rounded w-14 mx-auto" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-8 text-center">
          <p className="text-[13px] text-[#8B8B8B]">Cargando usuarios...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* KPI ROW */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
          <p className="text-[11px] text-[#8B8B8B] mb-1">Total Usuarios</p>
          <p className="text-[26px] font-bold text-[#1F114C]">{kpis.totalAll.toLocaleString()}</p>
          <p className="text-[10px] text-[#8B8B8B]">En la plataforma</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
          <p className="text-[11px] text-[#8B8B8B] mb-1">Activos Hoy</p>
          <p className="text-[26px] font-bold text-green-600">{kpis.activeToday}</p>
          <p className="text-[10px] text-[#8B8B8B]">
            {kpis.totalAll > 0 ? `${((kpis.activeToday / kpis.totalAll) * 100).toFixed(1)}% del total` : '0%'}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
          <p className="text-[11px] text-[#8B8B8B] mb-1">Platform Owners</p>
          <p className="text-[26px] font-bold text-[#1F114C]">{kpis.platformOwners}</p>
          <p className="text-[10px] text-[#8B8B8B]">Acceso total</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
          <p className="text-[11px] text-[#8B8B8B] mb-1">Inactivos</p>
          <p className="text-[26px] font-bold text-amber-500">{kpis.inactive}</p>
          <p className="text-[10px] text-amber-500 font-medium">Sin login 30+ dias</p>
        </div>
      </div>

      {/* FILTERS */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-[280px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            className="w-full h-9 pl-9 pr-3 border border-[#EDEDED] rounded-lg text-[12px] bg-white focus:outline-none focus:border-[#1F114C]"
            placeholder="Buscar por nombre o email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="h-9 px-3 border border-[#EDEDED] rounded-lg text-[12px] bg-white text-[#585858] focus:outline-none"
          value={orgFilter}
          onChange={e => setOrgFilter(e.target.value)}
        >
          <option value="">Todas las Organizaciones</option>
          {orgOptions.map(o => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <div className="flex items-center bg-white border border-[#EDEDED] rounded-lg overflow-hidden">
          <button
            className={`px-3 h-9 text-[12px] font-medium ${activeFilter === 'active' ? 'bg-[#1F114C] text-white' : 'text-[#585858]'}`}
            onClick={() => setActiveFilter('active')}
          >
            Activos
          </button>
          <button
            className={`px-3 h-9 text-[12px] font-medium ${activeFilter === 'all' ? 'bg-[#1F114C] text-white' : 'text-[#585858]'}`}
            onClick={() => setActiveFilter('all')}
          >
            Todos
          </button>
        </div>
      </div>

      {/* USER TABLE */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {users.length === 0 ? (
          <div className="p-12 text-center">
            <svg className="w-10 h-10 mx-auto mb-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
            <p className="text-[13px] text-[#8B8B8B]">No se encontraron usuarios</p>
            <p className="text-[11px] text-[#ABABAB] mt-1">Intenta ajustar los filtros de busqueda</p>
          </div>
        ) : (
          <>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#EDEDED]">
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Usuario</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Email</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Organizacion</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Rol</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Estado</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Ultimo Login</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Creado</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F3F3]">
                {users.map(user => {
                  const initials = getInitials(user.firstName, user.lastName);
                  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Sin nombre';
                  const roleSlug = user.isPlatformOwner
                    ? 'platform_owner'
                    : user.userRoles?.[0]?.role?.slug || 'employee';
                  const roleName = user.isPlatformOwner
                    ? 'platform_owner'
                    : user.userRoles?.[0]?.role?.slug || 'employee';
                  const roleColor = ROLE_COLORS[roleSlug] || ROLE_COLORS.employee;
                  const avatarBg = user.isActive ? getAvatarColor(fullName) : 'bg-gray-400';

                  return (
                    <tr key={user.id} className="hover:bg-[#FAFAFA]">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center text-white text-[10px] font-bold`}>
                            {initials}
                          </div>
                          <span className={`text-[13px] font-medium text-[#1F114C] ${!user.isActive ? 'opacity-60' : ''}`}>
                            {fullName}
                          </span>
                        </div>
                      </td>
                      <td className={`px-4 py-2.5 text-[12px] ${user.isActive ? 'text-[#585858]' : 'text-[#8B8B8B]'}`}>
                        {user.email}
                      </td>
                      <td className={`px-4 py-2.5 text-[12px] ${user.isActive ? 'text-[#585858]' : 'text-[#8B8B8B]'}`}>
                        {user.isPlatformOwner ? 'Plataforma' : user.organization?.name || '-'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${roleColor.bg} ${roleColor.text}`}>
                          {roleName}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`flex items-center gap-1.5 text-[12px] ${user.isActive ? 'text-[#585858]' : 'text-[#8B8B8B]'}`}>
                          <span className={`w-2 h-2 rounded-full ${user.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                          {user.isActive ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className={`px-4 py-2.5 text-[12px] ${user.isActive ? 'text-[#585858]' : 'text-[#8B8B8B]'}`}>
                        {formatLastLogin(user.lastLoginAt)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-[#8B8B8B]">
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <button className="px-2 py-1 text-[10px] text-[#1F114C] bg-[#F0EEF7] rounded font-medium hover:bg-[#E4E0F0]">Ver</button>
                          <button className="px-2 py-1 text-[10px] text-[#585858] bg-[#F3F3F3] rounded font-medium hover:bg-[#E8E8E8]">Editar</button>
                          {!user.isPlatformOwner && user.isActive && (
                            <>
                              <button className="px-2 py-1 text-[10px] text-amber-600 bg-amber-50 rounded font-medium hover:bg-amber-100">Impersonar</button>
                              <button className="px-2 py-1 text-[10px] text-[#DD0C15] bg-red-50 rounded font-medium hover:bg-red-100">Desactivar</button>
                            </>
                          )}
                          {!user.isPlatformOwner && !user.isActive && (
                            <button className="px-2 py-1 text-[10px] text-green-600 bg-green-50 rounded font-medium hover:bg-green-100">Activar</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#EDEDED]">
              <p className="text-[12px] text-[#8B8B8B]">
                Mostrando {users.length} de {total.toLocaleString()} usuarios
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
