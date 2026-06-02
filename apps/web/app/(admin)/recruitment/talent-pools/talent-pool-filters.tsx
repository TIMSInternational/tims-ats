'use client';

import { useI18n } from '../../../../lib/i18n';

interface PoolFilterProps {
  search: string;
  onSearchChange: (value: string) => void;
}

interface CheckboxOption {
  label: string;
  count: number;
  checked?: boolean;
}

function FilterCheckbox({ label, count, checked }: CheckboxOption) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-[#333] cursor-pointer">
      <input type="checkbox" defaultChecked={checked} className="w-3.5 h-3.5 accent-[#DD0C15]" />
      {label}
      <span className="text-[#8B8B8B] ml-auto">{count}</span>
    </label>
  );
}

export function TalentPoolFilters({ search, onSearchChange }: PoolFilterProps) {
  const { t } = useI18n();

  const poolTypes: CheckboxOption[] = [
    { label: t.talentPool.activeCandidates, count: 234, checked: true },
    { label: t.talentPool.passiveCandidates, count: 89, checked: true },
    { label: t.talentPool.historicFinalists, count: 156 },
    { label: t.talentPool.highPotentialRejected, count: 67 },
    { label: t.talentPool.referrals, count: 45 },
    { label: t.talentPool.internalCandidates, count: 23 },
    { label: t.talentPool.exEmployees, count: 12 },
  ];

  const locations: CheckboxOption[] = [
    { label: 'Bogota', count: 189, checked: true },
    { label: 'Medellin', count: 78 },
    { label: 'Lima', count: 56 },
    { label: t.talentPool.remote, count: 124 },
  ];

  const experience = [
    { label: t.talentPool.junior, checked: false },
    { label: t.talentPool.mid, checked: false },
    { label: t.talentPool.senior, checked: true },
    { label: t.talentPool.lead, checked: false },
  ];

  const skills = [
    { label: 'Node.js', active: true },
    { label: 'React', active: true },
    { label: 'Python', active: false },
    { label: 'AWS', active: false },
    { label: 'TypeScript', active: false },
    { label: 'Java', active: false },
    { label: 'SQL', active: false },
  ];

  const aiTags = [
    { label: t.talentPool.highPotential, active: true },
    { label: t.talentPool.naturalLeader, active: true },
    { label: t.talentPool.technicalProfile, active: false },
    { label: t.talentPool.bilingual, active: false },
  ];

  return (
    <div className="w-[250px] bg-white border-r border-[#EDEDED] p-4 overflow-y-auto shrink-0">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.talentPool.filters}</h3>
        <button className="text-[11px] text-[#DD0C15]">{t.talentPool.clearFilters}</button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="flex items-center gap-2 bg-[#F6F6F6] rounded-lg px-3 h-9">
          <svg className="w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t.talentPool.searchCandidate}
            className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-[#8B8B8B]"
          />
        </div>
      </div>

      {/* Pool Type */}
      <div className="mb-4">
        <p className="text-[11px] text-[#585858] font-medium mb-2">{t.talentPool.poolType}</p>
        <div className="space-y-1.5">
          {poolTypes.map((opt) => (
            <FilterCheckbox key={opt.label} {...opt} />
          ))}
        </div>
      </div>

      {/* FIT Score */}
      <div className="mb-4">
        <p className="text-[11px] text-[#585858] font-medium mb-2">{t.talentPool.fitScore}</p>
        <div className="flex items-center gap-2">
          <input type="range" min="0" max="100" defaultValue="60" className="flex-1 accent-[#1F114C] h-1.5" />
          <span className="text-[11px] text-[#1F114C] font-medium w-8">60+</span>
        </div>
      </div>

      {/* Skills */}
      <div className="mb-4">
        <p className="text-[11px] text-[#585858] font-medium mb-2">{t.talentPool.skills}</p>
        <div className="flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <span
              key={s.label}
              className={`text-[10px] px-2 py-0.5 rounded-full cursor-pointer ${
                s.active
                  ? 'bg-blue-50 text-blue-600 border border-blue-200'
                  : 'bg-[#F6F6F6] text-[#585858]'
              }`}
            >
              {s.label}
            </span>
          ))}
          <span className="text-[10px] text-[#DD0C15] cursor-pointer mt-1">{t.talentPool.seeMore}</span>
        </div>
      </div>

      {/* Location */}
      <div className="mb-4">
        <p className="text-[11px] text-[#585858] font-medium mb-2">{t.talentPool.locationLabel}</p>
        <div className="space-y-1.5">
          {locations.map((loc) => (
            <FilterCheckbox key={loc.label} {...loc} />
          ))}
        </div>
      </div>

      {/* Experience */}
      <div className="mb-4">
        <p className="text-[11px] text-[#585858] font-medium mb-2">{t.talentPool.experienceLabel}</p>
        <div className="space-y-1.5">
          {experience.map((exp) => (
            <label key={exp.label} className="flex items-center gap-2 text-[11px] text-[#333] cursor-pointer">
              <input type="checkbox" defaultChecked={exp.checked} className="w-3.5 h-3.5 accent-[#DD0C15]" />
              {exp.label}
            </label>
          ))}
        </div>
      </div>

      {/* AI Tags */}
      <div className="mb-4">
        <p className="text-[11px] text-[#585858] font-medium mb-2">{t.talentPool.aiTags}</p>
        <div className="flex flex-wrap gap-1.5">
          {aiTags.map((tag) => (
            <span
              key={tag.label}
              className={`text-[10px] px-2 py-0.5 rounded-full cursor-pointer ${
                tag.active
                  ? 'bg-teal-50 text-teal-600 border border-teal-200'
                  : 'bg-[#F6F6F6] text-[#585858]'
              }`}
            >
              {tag.label}
            </span>
          ))}
        </div>
      </div>

      {/* Saved Searches */}
      <div className="border-t border-[#EDEDED] pt-3">
        <p className="text-[11px] text-[#585858] font-medium mb-2">{t.talentPool.savedSearches}</p>
        <div className="space-y-1.5">
          <button className="w-full text-left bg-[#F6F6F6] rounded-lg px-3 py-2 text-[11px] text-[#333] hover:bg-[#EDEDED]">
            Sr. Engineers LATAM
          </button>
          <button className="w-full text-left bg-[#F6F6F6] rounded-lg px-3 py-2 text-[11px] text-[#333] hover:bg-[#EDEDED]">
            Product roles Bogota
          </button>
          <button className="text-[11px] text-[#DD0C15] mt-1">{t.talentPool.saveCurrentSearch}</button>
        </div>
      </div>
    </div>
  );
}
