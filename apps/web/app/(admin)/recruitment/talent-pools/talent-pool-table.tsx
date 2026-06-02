'use client';

import { useI18n } from '../../../../lib/i18n';

interface CandidateRow {
  initials: string;
  initialsColor: string;
  name: string;
  subtitle: string;
  location: string;
  fitScore: number;
  fitColor: string;
  typeBadge: string;
  typeBadgeStyle: string;
  activity: string;
  activityTime: string;
  tags: { label: string; style: string }[];
  actionLabel: string;
}

const CANDIDATES: CandidateRow[] = [
  {
    initials: 'DP', initialsColor: 'bg-[#1F114C]',
    name: 'Daniel Prieto', subtitle: 'Sr. Backend Engineer — MercadoLibre', location: 'Bogota · 7 anos exp',
    fitScore: 82, fitColor: 'bg-green-500',
    typeBadge: 'Finalista historico', typeBadgeStyle: 'bg-amber-50 text-amber-600',
    activity: 'Finalista para DevOps', activityTime: 'Hace 3 meses',
    tags: [
      { label: 'Node.js', style: 'bg-blue-50 text-blue-600' },
      { label: 'AWS', style: 'bg-blue-50 text-blue-600' },
      { label: 'Alto potencial', style: 'bg-teal-50 text-teal-600' },
    ],
    actionLabel: 'contact',
  },
  {
    initials: 'LR', initialsColor: 'bg-violet-600',
    name: 'Laura Ramirez', subtitle: 'Full-Stack Developer — Rappi', location: 'Bogota · 6 anos exp',
    fitScore: 79, fitColor: 'bg-green-500',
    typeBadge: 'Referida', typeBadgeStyle: 'bg-green-50 text-green-600',
    activity: 'Referida por Ana P.', activityTime: 'Hace 1 semana',
    tags: [
      { label: 'React', style: 'bg-blue-50 text-blue-600' },
      { label: 'TypeScript', style: 'bg-blue-50 text-blue-600' },
      { label: 'Bilingue', style: 'bg-green-50 text-green-600' },
    ],
    actionLabel: 'contact',
  },
  {
    initials: 'MG', initialsColor: 'bg-teal-600',
    name: 'Miguel Garcia', subtitle: 'DevOps Engineer — Globant', location: 'Medellin · 5 anos exp',
    fitScore: 71, fitColor: 'bg-amber-500',
    typeBadge: 'Rechazado alto pot.', typeBadgeStyle: 'bg-red-50 text-[#DD0C15]',
    activity: 'No paso entrevista final', activityTime: 'Hace 5 meses',
    tags: [
      { label: 'K8s', style: 'bg-blue-50 text-blue-600' },
      { label: 'AWS', style: 'bg-blue-50 text-blue-600' },
      { label: 'Lider natural', style: 'bg-teal-50 text-teal-600' },
    ],
    actionLabel: 'recontact',
  },
  {
    initials: 'CV', initialsColor: 'bg-blue-600',
    name: 'Camila Velasquez', subtitle: 'Tech Lead — Nubank (interno)', location: 'Bogota · 8 anos exp',
    fitScore: 88, fitColor: 'bg-green-500',
    typeBadge: 'Candidato interno', typeBadgeStyle: 'bg-purple-50 text-purple-600',
    activity: 'Busca movilidad interna', activityTime: 'Hace 2 semanas',
    tags: [
      { label: 'Node.js', style: 'bg-blue-50 text-blue-600' },
      { label: 'React', style: 'bg-blue-50 text-blue-600' },
      { label: 'Alto potencial', style: 'bg-teal-50 text-teal-600' },
    ],
    actionLabel: 'assign',
  },
  {
    initials: 'RO', initialsColor: 'bg-amber-600',
    name: 'Roberto Ortiz', subtitle: 'Sr. Software Engineer — ex-TIMS', location: 'Bogota · 9 anos exp',
    fitScore: 85, fitColor: 'bg-green-500',
    typeBadge: 'Ex-colaborador', typeBadgeStyle: 'bg-orange-50 text-orange-600',
    activity: 'Salio por oportunidad', activityTime: 'Hace 1 ano',
    tags: [
      { label: 'Node.js', style: 'bg-blue-50 text-blue-600' },
      { label: 'Python', style: 'bg-blue-50 text-blue-600' },
      { label: 'Recontratable', style: 'bg-orange-50 text-orange-600' },
    ],
    actionLabel: 'recontact',
  },
  {
    initials: 'AS', initialsColor: 'bg-pink-600',
    name: 'Andrea Silva', subtitle: 'Software Architect — Freelance', location: 'Remoto · 10 anos exp',
    fitScore: 76, fitColor: 'bg-green-500',
    typeBadge: 'Pasivo', typeBadgeStyle: 'bg-gray-50 text-gray-600',
    activity: 'Contactada via LinkedIn', activityTime: 'Hace 2 meses',
    tags: [
      { label: 'React', style: 'bg-blue-50 text-blue-600' },
      { label: 'AWS', style: 'bg-blue-50 text-blue-600' },
      { label: 'Bilingue', style: 'bg-green-50 text-green-600' },
    ],
    actionLabel: 'contact',
  },
];

function CandidateActionButton({ actionLabel, t }: { actionLabel: string; t: Record<string, string> }) {
  const labelMap: Record<string, string> = {
    contact: t.contact,
    recontact: t.recontact,
    assign: t.assignToVacancy,
  };
  return (
    <button className="text-[10px] text-[#DD0C15] bg-red-50 px-2 py-1 rounded font-medium">
      {labelMap[actionLabel] ?? actionLabel}
    </button>
  );
}

export function TalentPoolTable() {
  const { t } = useI18n();

  return (
    <>
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center px-4 py-2.5 bg-[#FAFAFA] border-b border-[#EDEDED] text-[11px] text-[#585858] font-medium">
          <div className="w-8"><input type="checkbox" className="w-3.5 h-3.5 accent-[#DD0C15]" /></div>
          <div className="w-[280px]">{t.talentPool.candidate}</div>
          <div className="w-[100px] text-center">{t.talentPool.fitScore}</div>
          <div className="w-[120px]">{t.talentPool.type}</div>
          <div className="w-[140px]">{t.talentPool.lastActivity}</div>
          <div className="w-[180px]">{t.talentPool.tags}</div>
          <div className="flex-1 text-right">{t.talentPool.actions}</div>
        </div>

        {/* Rows */}
        {CANDIDATES.map((c, idx) => (
          <div
            key={c.name}
            className={`flex items-center px-4 py-3 hover:bg-[#FAFAFA] cursor-pointer ${
              idx < CANDIDATES.length - 1 ? 'border-b border-[#F0F0F0]' : ''
            } ${idx % 2 === 1 ? 'bg-[#FAFAFA]' : ''}`}
          >
            <div className="w-8"><input type="checkbox" className="w-3.5 h-3.5 accent-[#DD0C15]" /></div>
            <div className="w-[280px] flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full ${c.initialsColor} flex items-center justify-center text-white text-[11px] font-bold shrink-0`}>
                {c.initials}
              </div>
              <div>
                <p className="text-[12px] font-medium text-[#333]">{c.name}</p>
                <p className="text-[10px] text-[#8B8B8B]">{c.subtitle}</p>
                <p className="text-[10px] text-[#8B8B8B]">{c.location}</p>
              </div>
            </div>
            <div className="w-[100px] text-center">
              <span className={`${c.fitColor} text-white text-[10px] font-bold px-2 py-0.5 rounded-full`}>
                {c.fitScore}
              </span>
            </div>
            <div className="w-[120px]">
              <span className={`text-[10px] ${c.typeBadgeStyle} px-2 py-0.5 rounded-full`}>{c.typeBadge}</span>
            </div>
            <div className="w-[140px]">
              <p className="text-[11px] text-[#585858]">{c.activity}</p>
              <p className="text-[10px] text-[#8B8B8B]">{c.activityTime}</p>
            </div>
            <div className="w-[180px] flex flex-wrap gap-1">
              {c.tags.map((tag) => (
                <span key={tag.label} className={`text-[9px] ${tag.style} px-1.5 py-0.5 rounded`}>{tag.label}</span>
              ))}
            </div>
            <div className="flex-1 flex justify-end gap-1.5">
              <CandidateActionButton actionLabel={c.actionLabel} t={t.talentPool} />
              <button className="text-[10px] text-[#1F114C] bg-[#F6F6F6] px-2 py-1 rounded">
                {t.talentPool.profile}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <span className="text-[11px] text-[#8B8B8B]">
          {t.talentPool.showing} 1-6 de 323 {t.talentPool.candidatesLabel}
        </span>
        <div className="flex items-center gap-1">
          <button className="w-8 h-8 rounded-lg border border-[#EDEDED] text-[#8B8B8B] flex items-center justify-center text-[11px] opacity-50" disabled>
            ‹
          </button>
          <button className="w-8 h-8 rounded-lg bg-[#1F114C] text-white flex items-center justify-center text-[11px] font-medium">1</button>
          <button className="w-8 h-8 rounded-lg border border-[#EDEDED] text-[#585858] flex items-center justify-center text-[11px]">2</button>
          <button className="w-8 h-8 rounded-lg border border-[#EDEDED] text-[#585858] flex items-center justify-center text-[11px]">3</button>
          <span className="text-[11px] text-[#8B8B8B] px-1">...</span>
          <button className="w-8 h-8 rounded-lg border border-[#EDEDED] text-[#585858] flex items-center justify-center text-[11px]">54</button>
          <button className="w-8 h-8 rounded-lg border border-[#EDEDED] text-[#585858] flex items-center justify-center text-[11px]">›</button>
        </div>
      </div>
    </>
  );
}
