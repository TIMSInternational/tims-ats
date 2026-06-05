'use client';

import { useI18n } from '../../../../lib/i18n';
import type { TalentPoolFilterState } from './page';

interface PoolFilterProps {
  filters: TalentPoolFilterState;
  onFilterChange: <K extends keyof TalentPoolFilterState>(key: K, value: TalentPoolFilterState[K]) => void;
  onClear: () => void;
}

const POOL_TYPE_OPTIONS = [
  { value: 'active', i18nKey: 'activeCandidates' },
  { value: 'passive', i18nKey: 'passiveCandidates' },
  { value: 'historic_finalist', i18nKey: 'historicFinalists' },
  { value: 'high_potential_rejected', i18nKey: 'highPotentialRejected' },
  { value: 'referral', i18nKey: 'referrals' },
  { value: 'internal', i18nKey: 'internalCandidates' },
  { value: 'ex_employee', i18nKey: 'exEmployees' },
] as const;

const LOCATION_OPTIONS = ['Bogota', 'Medellin', 'Lima', 'Remoto'];

const EXPERIENCE_OPTIONS = [
  { value: 'junior', i18nKey: 'junior', min: 0, max: 2 },
  { value: 'mid', i18nKey: 'mid', min: 3, max: 5 },
  { value: 'senior', i18nKey: 'senior', min: 6, max: 9 },
  { value: 'lead', i18nKey: 'lead', min: 10, max: 99 },
] as const;

const SKILL_OPTIONS = ['Node.js', 'React', 'Python', 'AWS', 'TypeScript', 'Java', 'SQL', 'K8s', 'Go', 'Docker'];

function toggleArrayValue(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

export function TalentPoolFilters({ filters, onFilterChange, onClear }: PoolFilterProps) {
  const { t } = useI18n();
  const tp = t.talentPool;

  return (
    <div className="hidden md:block w-[250px] bg-white border-r border-[#EDEDED] p-4 overflow-y-auto shrink-0">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{tp.filters}</h3>
        <button onClick={onClear} className="text-[11px] text-[#DD0C15]">{tp.clearFilters}</button>
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
            value={filters.search}
            onChange={(e) => onFilterChange('search', e.target.value)}
            placeholder={tp.searchCandidate}
            className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-[#8B8B8B]"
          />
        </div>
      </div>

      {/* Pool Type */}
      <div className="mb-4">
        <p className="text-[11px] text-[#585858] font-medium mb-2">{tp.poolType}</p>
        <div className="space-y-1.5">
          {POOL_TYPE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-[11px] text-[#333] cursor-pointer">
              <input
                type="checkbox"
                checked={filters.poolTypes.includes(opt.value)}
                onChange={() => onFilterChange('poolTypes', toggleArrayValue(filters.poolTypes, opt.value))}
                className="w-3.5 h-3.5 accent-[#DD0C15]"
              />
              {tp[opt.i18nKey] ?? opt.value}
            </label>
          ))}
        </div>
      </div>

      {/* FIT Score */}
      <div className="mb-4">
        <p className="text-[11px] text-[#585858] font-medium mb-2">{tp.fitScore}</p>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="0"
            max="100"
            value={filters.fitMin}
            onChange={(e) => onFilterChange('fitMin', Number(e.target.value))}
            className="flex-1 accent-[#1F114C] h-1.5"
          />
          <span className="text-[11px] text-[#1F114C] font-medium w-8">{filters.fitMin}+</span>
        </div>
      </div>

      {/* Skills */}
      <div className="mb-4">
        <p className="text-[11px] text-[#585858] font-medium mb-2">{tp.skills}</p>
        <div className="flex flex-wrap gap-1.5">
          {SKILL_OPTIONS.map((skill) => {
            const active = filters.skills.includes(skill);
            return (
              <button
                key={skill}
                onClick={() => onFilterChange('skills', toggleArrayValue(filters.skills, skill))}
                className={`text-[10px] px-2 py-0.5 rounded-full cursor-pointer ${
                  active
                    ? 'bg-blue-50 text-blue-600 border border-blue-200'
                    : 'bg-[#F6F6F6] text-[#585858]'
                }`}
              >
                {skill}
              </button>
            );
          })}
        </div>
      </div>

      {/* Location */}
      <div className="mb-4">
        <p className="text-[11px] text-[#585858] font-medium mb-2">{tp.locationLabel}</p>
        <div className="space-y-1.5">
          {LOCATION_OPTIONS.map((loc) => (
            <label key={loc} className="flex items-center gap-2 text-[11px] text-[#333] cursor-pointer">
              <input
                type="checkbox"
                checked={filters.locations.includes(loc)}
                onChange={() => onFilterChange('locations', toggleArrayValue(filters.locations, loc))}
                className="w-3.5 h-3.5 accent-[#DD0C15]"
              />
              {loc === 'Remoto' ? (tp.remote ?? loc) : loc}
            </label>
          ))}
        </div>
      </div>

      {/* Experience */}
      <div className="mb-4">
        <p className="text-[11px] text-[#585858] font-medium mb-2">{tp.experienceLabel}</p>
        <div className="space-y-1.5">
          {EXPERIENCE_OPTIONS.map((exp) => (
            <label key={exp.value} className="flex items-center gap-2 text-[11px] text-[#333] cursor-pointer">
              <input
                type="checkbox"
                checked={filters.experienceLevels.includes(exp.value)}
                onChange={() => onFilterChange('experienceLevels', toggleArrayValue(filters.experienceLevels, exp.value))}
                className="w-3.5 h-3.5 accent-[#DD0C15]"
              />
              {tp[exp.i18nKey] ?? exp.value}
            </label>
          ))}
        </div>
      </div>

      {/* Saved Searches */}
      <div className="border-t border-[#EDEDED] pt-3">
        <p className="text-[11px] text-[#585858] font-medium mb-2">{tp.savedSearches}</p>
        <div className="space-y-1.5">
          <button className="w-full text-left bg-[#F6F6F6] rounded-lg px-3 py-2 text-[11px] text-[#333] hover:bg-[#EDEDED]">
            Sr. Engineers LATAM
          </button>
          <button className="w-full text-left bg-[#F6F6F6] rounded-lg px-3 py-2 text-[11px] text-[#333] hover:bg-[#EDEDED]">
            Product roles Bogota
          </button>
          <button className="text-[11px] text-[#DD0C15] mt-1">{tp.saveCurrentSearch}</button>
        </div>
      </div>
    </div>
  );
}
