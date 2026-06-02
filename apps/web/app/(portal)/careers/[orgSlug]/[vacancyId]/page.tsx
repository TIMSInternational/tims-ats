'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { trpc } from '../../../../../lib/trpc';
import { formatDate } from '../../../../../lib/format-utils';
import { Skeleton } from '../../../../../components';

export default function JobDetailPage({ params }: { params: Promise<{ orgSlug: string; vacancyId: string }> }) {
  const { orgSlug, vacancyId } = use(params);
  const vacancy = trpc.portal.getVacancy.useQuery({ id: vacancyId });
  const [applied, setApplied] = useState(false);

  const applyMutation = trpc.portal.applyToVacancy.useMutation({
    onSuccess: () => setApplied(true),
  });

  if (vacancy.isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Skeleton className="h-8 w-96 mb-3 rounded" />
        <Skeleton className="h-4 w-64 mb-6 rounded" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!vacancy.data) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <p className="text-sm text-[#8B8B8B]">Vacante no encontrada</p>
        <Link href={`/careers/${orgSlug}`} className="text-sm text-[#1F114C] hover:underline mt-2 inline-block">
          Volver a vacantes
        </Link>
      </div>
    );
  }

  const v = vacancy.data;
  const salary = v.salary as { min?: number; max?: number; currency?: string } | null;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/careers/${orgSlug}`} className="text-sm text-[#8B8B8B] hover:text-[#585858] transition">Vacantes</Link>
        <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
        <span className="text-sm text-[#1F114C] font-medium">{v.title}</span>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.06)] mb-6">
        <h1 className="text-2xl font-bold text-[#1F114C] mb-2">{v.title}</h1>
        <div className="flex items-center gap-4 text-sm text-[#585858] mb-4 flex-wrap">
          {v.company && <span>{v.company.name}</span>}
          {v.location && (
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
              {v.location}
            </span>
          )}
          {v.contractType && <span>{v.contractType}</span>}
          {v.remotePolicy && (
            <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600 font-medium">
              {v.remotePolicy === 'remote' ? 'Remoto' : v.remotePolicy === 'hybrid' ? 'Hibrido' : 'Presencial'}
            </span>
          )}
          {salary && salary.min && salary.max && (
            <span className="font-medium text-[#333]">
              ${salary.min.toLocaleString()} – ${salary.max.toLocaleString()} {salary.currency ?? 'COP'}
            </span>
          )}
        </div>

        {applied ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <svg className="w-8 h-8 text-green-500 mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <p className="text-sm font-medium text-green-700">Aplicacion enviada exitosamente</p>
            <p className="text-xs text-green-600 mt-1">Te contactaremos pronto con los siguientes pasos.</p>
          </div>
        ) : (
          <button
            onClick={() => applyMutation.mutate({
              vacancyId: v.id,
              firstName: 'Portal',
              lastName: 'Applicant',
              email: `applicant-${Date.now()}@portal.tims.co`,
              source: 'portal',
            })}
            disabled={applyMutation.isPending}
            className="w-full h-12 rounded-xl bg-[#DD0C15] text-white text-sm font-semibold hover:bg-[#c00b13] transition disabled:opacity-50"
          >
            {applyMutation.isPending ? 'Enviando...' : 'Aplicar a esta vacante'}
          </button>
        )}
      </div>

      {v.description && (
        <div className="bg-white rounded-xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] mb-6">
          <h2 className="text-lg font-semibold text-[#1F114C] mb-4">Descripcion del puesto</h2>
          <div className="text-sm text-[#585858] leading-relaxed whitespace-pre-wrap">{v.description}</div>
        </div>
      )}

      <div className="bg-white rounded-xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h2 className="text-lg font-semibold text-[#1F114C] mb-4">Detalles</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-[#8B8B8B] mb-0.5">Posiciones</p>
            <p className="text-sm text-[#333]">{v.positions}</p>
          </div>
          <div>
            <p className="text-xs text-[#8B8B8B] mb-0.5">Publicada</p>
            <p className="text-sm text-[#333]">{formatDate(v.createdAt)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
