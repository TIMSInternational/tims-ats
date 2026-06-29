'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { trpc } from '../../../../../../lib/trpc';
import { Skeleton } from '../../../../../../components';
import { toast } from '../../../../../../lib/toast';
import { ApplyModal } from './apply-modal';
import { useI18n } from '../../../../../../lib/i18n';

interface JobDetailViewProps {
  orgSlug: string;
  vacancyId: string;
}

type Salary = { min?: number; max?: number; currency?: string } | null;

function timeAgo(date: Date | string): string {
  const d = new Date(date);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff < 7) return `Hace ${diff} dias`;
  if (diff < 30) return `Hace ${Math.floor(diff / 7)} semanas`;
  return `Hace ${Math.floor(diff / 30)} meses`;
}

function fmtSalary(s: Salary) {
  if (!s) return null;
  const cur = s.currency ?? 'COP';
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
  if (s.min && s.max) return `${cur} ${fmt(s.min)} - ${fmt(s.max)}`;
  if (s.min) return `Desde ${cur} ${fmt(s.min)}`;
  if (s.max) return `Hasta ${cur} ${fmt(s.max)}`;
  return null;
}

function remoteLabel(p: string | null) {
  if (!p) return null;
  if (p === 'remote') return 'Remoto';
  if (p === 'hybrid') return 'Hibrido';
  return 'Presencial';
}

export function JobDetailView({ orgSlug, vacancyId }: JobDetailViewProps) {
  const { t } = useI18n();
  const p = t.portal;
  const [search, setSearch] = useState('');
  const [showApply, setShowApply] = useState(false);
  const vacancy = trpc.portal.getVacancy.useQuery({ id: vacancyId });
  const vacancies = trpc.portal.listVacancies.useQuery(
    { organizationId: vacancy.data?.organizationId ?? '', take: 20 },
    { enabled: !!vacancy.data?.organizationId },
  );

  const sidebarItems = vacancies.data?.items ?? [];
  const filtered = useMemo(() => {
    if (!search.trim()) return sidebarItems;
    const q = search.toLowerCase();
    return sidebarItems.filter(
      (item) => item.title.toLowerCase().includes(q) || item.location?.toLowerCase().includes(q),
    );
  }, [sidebarItems, search]);

  if (vacancy.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="w-full lg:w-[400px] space-y-4">
          <Skeleton className="h-8 w-3/4 rounded" />
          <Skeleton className="h-4 w-1/2 rounded" />
          <Skeleton className="h-32 w-full rounded" />
        </div>
      </div>
    );
  }

  if (!vacancy.data) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-[#8B8B8B]">
        <p className="text-sm">{p.vacancyNotFound}</p>
        <Link href={`/careers/${orgSlug}`} className="text-sm text-[#1F114C] hover:underline">{p.backToVacancies}</Link>
      </div>
    );
  }

  const v = vacancy.data;
  const salary = v.salary as Salary;
  const requirements = v.jobProfile?.requirements as string[] | null;
  const competencies = v.jobProfile?.competencies as string[] | null;
  const companyName = v.company?.name ?? v.organization?.name ?? 'Empresa';
  const companyInitial = companyName.charAt(0).toUpperCase();
  const remote = remoteLabel(v.remotePolicy);

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* Sticky nav */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[#EDEDED] bg-white px-6">
        <Link href={`/careers/${orgSlug}`} className="flex items-center gap-2 text-[13px] font-medium text-[#585858] hover:text-[#1F114C]">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {p.backToVacancies}
        </Link>
        <span className="ml-auto text-[13px] font-bold tracking-tight text-[#1F114C]">TIMS ATS</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="hidden w-[380px] shrink-0 flex-col border-r border-[#EDEDED] bg-[#FAFAFA] lg:flex">
          <div className="border-b border-[#EDEDED] p-4">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={p.searchVacanciesPlaceholder}
              className="w-full rounded-lg border border-[#EDEDED] bg-white px-3 py-2 text-[13px] text-[#333] outline-none placeholder:text-[#8B8B8B] focus:border-[#1F114C]"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {vacancies.isLoading ? (
              <div className="space-y-3 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
            ) : (
              filtered.map((item) => {
                const isActive = item.id === vacancyId;
                const iSalary = item.salary as Salary;
                return (
                  <Link key={item.id} href={`/careers/${orgSlug}/${item.id}`}
                    className={`block border-b border-[#EDEDED] px-4 py-3 transition-colors ${isActive ? 'border-l-2 border-l-[#DD0C15] bg-white' : 'border-l-2 border-l-transparent hover:bg-white'}`}>
                    <div className="flex gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1F114C] text-[10px] font-bold text-white">
                        {(item.company?.name ?? 'E').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-[13px] font-semibold ${isActive ? 'text-[#DD0C15]' : 'text-[#1F114C]'}`}>{item.title}</p>
                        <p className="truncate text-[11px] text-[#8B8B8B]">{item.company?.name}</p>
                        {item.location && <p className="text-[11px] text-[#8B8B8B]">{item.location}{item.remotePolicy === 'remote' ? ' (Remoto)' : ''}</p>}
                        {fmtSalary(iSalary) && <p className="mt-0.5 text-[11px] font-medium text-[#333]">{fmtSalary(iSalary)}</p>}
                        <div className="mt-1 flex items-center gap-2">
                          {item.contractType && <span className="rounded bg-[#F6F6F6] px-1.5 py-0.5 text-[10px] text-[#585858]">{item.contractType}</span>}
                          <span className="ml-auto text-[10px] text-[#8B8B8B]">{timeAgo(item.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </aside>

        {/* Right panel */}
        <main className="flex-1 overflow-y-auto">
          {/* Header */}
          <div className="border-b border-[#EDEDED] bg-white px-8 py-6">
            <div className="mb-3 flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#1F114C] text-lg font-bold text-white">{companyInitial}</div>
              <div className="min-w-0">
                <p className="text-[13px] text-[#8B8B8B]">{companyName}</p>
                <h1 className="text-[22px] font-bold leading-tight text-[#1F114C]">{v.title}</h1>
              </div>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-4 text-[13px] text-[#585858]">
              {v.location && (
                <span className="flex items-center gap-1">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
                  {v.location}{remote ? ` (${remote})` : ''}
                </span>
              )}
              <span>Publicada {timeAgo(v.createdAt)}</span>
              <span>{v.applicantCount} {v.applicantCount === 1 ? 'persona aplico' : 'personas aplicaron'}</span>
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {remote && <span className="rounded-md bg-blue-50 px-2.5 py-1 text-[12px] font-medium text-blue-700">{remote}</span>}
              {v.contractType && <span className="rounded-md bg-green-50 px-2.5 py-1 text-[12px] font-medium text-green-700">{v.contractType}</span>}
              {v.priority === 'urgent' && <span className="rounded-md bg-amber-50 px-2.5 py-1 text-[12px] font-medium text-amber-700">Urgente</span>}
              {salary && fmtSalary(salary) && <span className="rounded-md bg-[#F6F6F6] px-2.5 py-1 text-[12px] font-semibold text-[#1F114C]">{fmtSalary(salary)} / ano</span>}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setShowApply(true)} className="h-11 rounded-lg bg-[#DD0C15] px-8 text-[14px] font-semibold text-white transition-colors hover:bg-[#c00b13]">{p.applyNow}</button>
              <button onClick={() => toast('Guardado')} className="h-11 rounded-lg border border-[#1F114C] px-6 text-[14px] font-semibold text-[#1F114C] transition-colors hover:bg-[#F6F6F6]">Guardar</button>
            </div>
            {showApply && (
              <ApplyModal
                vacancyId={v.id}
                vacancyTitle={v.title}
                companyName={companyName}
                onClose={() => setShowApply(false)}
              />
            )}
          </div>

          {/* Content */}
          <div className="max-w-3xl space-y-8 px-8 py-6">
            {v.description && (
              <section>
                <h2 className="mb-3 text-[16px] font-bold text-[#1F114C]">{p.aboutPosition}</h2>
                <div className="text-[14px] leading-relaxed text-[#585858] whitespace-pre-wrap">{v.description}</div>
              </section>
            )}

            {requirements && requirements.length > 0 && (
              <section>
                <h2 className="mb-3 text-[16px] font-bold text-[#1F114C]">Requisitos</h2>
                <ul className="space-y-2">
                  {requirements.map((req, i) => (
                    <li key={i} className="flex items-start gap-2 text-[14px] text-[#585858]">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#DD0C15]" />{String(req)}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {competencies && competencies.length > 0 && (
              <section>
                <h2 className="mb-3 text-[16px] font-bold text-[#1F114C]">Competencias</h2>
                <div className="flex flex-wrap gap-2">
                  {competencies.map((c, i) => (
                    <span key={i} className="rounded-full border border-[#EDEDED] bg-[#F6F6F6] px-3 py-1.5 text-[12px] font-medium text-[#1F114C]">{String(c)}</span>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-3 text-[16px] font-bold text-[#1F114C]">Detalles</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <DetailItem label="Posiciones" value={String(v.positions)} />
                {v.contractType && <DetailItem label="Tipo de contrato" value={v.contractType} />}
                {remote && <DetailItem label="Modalidad" value={remote} />}
                {v.location && <DetailItem label="Ubicacion" value={v.location} />}
                {fmtSalary(salary) && <DetailItem label="Salario" value={`${fmtSalary(salary)} / ano`} />}
                {v.unit?.name && <DetailItem label="Departamento" value={v.unit.name} />}
              </div>
            </section>

            <section className="pb-12">
              <h2 className="mb-3 text-[16px] font-bold text-[#1F114C]">{p.aboutCompany}</h2>
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1F114C] text-sm font-bold text-white">{companyInitial}</div>
                <div>
                  <p className="text-[14px] font-semibold text-[#1F114C]">{companyName}</p>
                  {v.organization?.name && v.organization.name !== companyName && (
                    <p className="text-[12px] text-[#8B8B8B]">{v.organization.name}</p>
                  )}
                </div>
              </div>
              <p className="text-[13px] leading-relaxed text-[#585858]">
                {companyName} utiliza TIMS ATS para conectar con el mejor talento a traves de evaluaciones cientificas y procesos de seleccion transparentes.
              </p>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#F6F6F6] p-3">
      <p className="text-[11px] text-[#8B8B8B]">{label}</p>
      <p className="mt-0.5 text-[13px] font-medium text-[#333]">{value}</p>
    </div>
  );
}
