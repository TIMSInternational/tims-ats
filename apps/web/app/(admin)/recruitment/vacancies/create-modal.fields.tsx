'use client';

import { CONTRACT_TYPES, inputCls, labelCls, positionCountLabel, textareaCls } from './create-modal.helpers';
import { useI18n } from '../../../../lib/i18n';
import { enumLabel, formatPortalSalary, parsePortalSalary } from '../../../(portal)/careers/[orgSlug]/_lib/vacancy-display';
import { AiGeneratePanel, InclusiveCheckPanel } from './create-modal.ai-panel';
import { currencyOptions } from '../../../../lib/currency-options';

interface Step1Props {
  title: string;
  setTitle: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  remotePolicy: 'onsite' | 'remote' | 'hybrid';
  setRemotePolicy: (v: 'onsite' | 'remote' | 'hybrid') => void;
  contractType: string;
  setContractType: (v: string) => void;
  positions: number;
  setPositions: (v: number) => void;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  setPriority: (v: 'low' | 'medium' | 'high' | 'urgent') => void;
}

export function Step1BasicInfo({
  title, setTitle, location, setLocation, remotePolicy, setRemotePolicy,
  contractType, setContractType, positions, setPositions, priority, setPriority,
}: Step1Props) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>{t.vacancies.titleField}</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.vacancies.titlePlaceholder} maxLength={200} className={inputCls} autoFocus />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{t.vacancies.location}</label>
          <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t.vacancies.locationPlaceholder} maxLength={200} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>{t.vacancies.workModality}</label>
          <div className="flex bg-[#F6F6F6] rounded-lg overflow-hidden h-10">
            {(['onsite', 'hybrid', 'remote'] as const).map((opt) => (
              <button key={opt} type="button" onClick={() => setRemotePolicy(opt)}
                className={`flex-1 text-[12px] font-medium transition ${remotePolicy === opt ? 'bg-[#1F114C] text-white' : 'text-[#585858]'}`}>
                {opt === 'onsite' ? t.vacancies.onsite : opt === 'hybrid' ? t.vacancies.hybrid : t.vacancies.remote}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>{t.vacancies.contractTypeLabel}</label>
          <select value={contractType} onChange={(e) => setContractType(e.target.value)} className={`${inputCls} bg-white`}>
            {CONTRACT_TYPES.map((value) => <option key={value} value={value}>{t.portal.contractTypes[value]}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>{t.vacancies.positions}</label>
          <input type="number" value={positions} onChange={(e) => setPositions(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))} min={1} max={100} className={inputCls} />
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className={labelCls}>{t.vacancies.priority}</label>
          <div className="flex bg-[#F6F6F6] rounded-lg overflow-hidden h-10">
            {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
              <button key={p} type="button" onClick={() => setPriority(p)}
                className={`flex-1 text-[11px] font-medium transition ${
                  priority === p
                    ? p === 'urgent' ? 'bg-[#DD0C15] text-white' : 'bg-[#1F114C] text-white'
                    : 'text-[#585858]'
                }`}>
                {p === 'low' ? t.vacancies.priorityLow : p === 'medium' ? t.vacancies.priorityMedium : p === 'high' ? t.vacancies.priorityHigh : t.vacancies.priorityUrgent}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface Step2Props {
  title: string;
  location: string;
  description: string;
  setDescription: (v: string) => void;
  responsibilities: string;
  setResponsibilities: (v: string) => void;
  requirements: string;
  setRequirements: (v: string) => void;
  desiredQualifications: string;
  setDesiredQualifications: (v: string) => void;
  benefits: string;
  setBenefits: (v: string) => void;
  setSocialDescription: (v: string) => void;
  setWhatsappDescription: (v: string) => void;
}

export function Step2Description({
  title, location, description, setDescription, responsibilities, setResponsibilities,
  requirements, setRequirements, desiredQualifications, setDesiredQualifications,
  benefits, setBenefits, setSocialDescription, setWhatsappDescription,
}: Step2Props) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <AiGeneratePanel
        title={title}
        location={location}
        onUseFormal={(desc, sections) => {
          setDescription(desc);
          setResponsibilities(sections.responsibilities.map((r) => `- ${r}`).join('\n'));
          setRequirements(sections.requirements.map((r) => `- ${r}`).join('\n'));
          setBenefits(sections.benefits.map((r) => `- ${r}`).join('\n'));
        }}
        onUseSocial={setSocialDescription}
        onUseWhatsapp={setWhatsappDescription}
      />
      <div>
        <label className={labelCls}>{t.vacancies.aboutRole}</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t.vacancies.descPlaceholder} maxLength={2000} rows={3} className={textareaCls} autoFocus />
        <div className="mt-2">
          <InclusiveCheckPanel text={description} />
        </div>
      </div>
      <div>
        <label className={labelCls}>{t.vacancies.keyResponsibilities}</label>
        <textarea value={responsibilities} onChange={(e) => setResponsibilities(e.target.value)} placeholder="- Disenar y desarrollar soluciones escalables&#10;- Liderar revisiones de codigo&#10;- Colaborar con equipo de producto" maxLength={2000} rows={4} className={textareaCls} />
        <p className="text-[10px] text-[#8B8B8B] mt-1">{t.vacancies.oneLinePerResp}</p>
      </div>
      <div>
        <label className={labelCls}>{t.vacancies.minRequirements}</label>
        <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} placeholder="- 5+ anos de experiencia en desarrollo de software&#10;- Ingenieria de Sistemas o afines&#10;- Ingles B2+" maxLength={2000} rows={3} className={textareaCls} />
      </div>
      <div>
        <label className={labelCls}>{t.vacancies.desiredQualifications}</label>
        <textarea value={desiredQualifications} onChange={(e) => setDesiredQualifications(e.target.value)} placeholder="- Experiencia con AWS/GCP&#10;- Certificaciones relevantes&#10;- Experiencia en startups" maxLength={2000} rows={2} className={textareaCls} />
      </div>
      <div>
        <label className={labelCls}>{t.vacancies.benefitsLabel}</label>
        <textarea value={benefits} onChange={(e) => setBenefits(e.target.value)} placeholder="- Plan de salud prepagada&#10;- Horario flexible&#10;- Presupuesto de capacitacion&#10;- Home office stipend" maxLength={1500} rows={3} className={textareaCls} />
      </div>
    </div>
  );
}

interface Step3Props {
  salaryMin: string;
  setSalaryMin: (v: string) => void;
  salaryMax: string;
  setSalaryMax: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  salaryPeriod: 'monthly' | 'yearly';
  setSalaryPeriod: (v: 'monthly' | 'yearly') => void;
  slaTargetDays: string;
  setSlaTargetDays: (v: string) => void;
  autoPublish: boolean;
  setAutoPublish: (v: boolean) => void;
  requireApproval: boolean;
  setRequireApproval: (v: boolean) => void;
  title: string;
  location: string;
  remotePolicy: 'onsite' | 'remote' | 'hybrid';
  contractType: string;
  positions: number;
}

export function Step3Compensation({
  salaryMin, setSalaryMin, salaryMax, setSalaryMax, currency, setCurrency,
  salaryPeriod, setSalaryPeriod, slaTargetDays, setSlaTargetDays,
  autoPublish, setAutoPublish, requireApproval, setRequireApproval,
  title, location, remotePolicy, contractType, positions,
}: Step3Props) {
  const { t, locale } = useI18n();
  const currencies = currencyOptions();
  // Same formatter as the vacancy detail and the careers portal: currency code + period, locale grouping.
  const salary = parsePortalSalary({
    min: salaryMin ? Number(salaryMin) : undefined,
    max: salaryMax ? Number(salaryMax) : undefined,
    currency,
    period: salaryPeriod,
  });
  const salaryText = salary ? formatPortalSalary(salary, locale, t.portal) : null;
  const remoteLabel = enumLabel(remotePolicy, t.portal.remotePolicies);
  const contractLabel = enumLabel(contractType, t.portal.contractTypes);
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[13px] font-medium text-[#1F114C] mb-3">{t.vacancies.salaryRange}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className={labelCls}>{t.vacancies.salaryMin}</label>
            <input type="number" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} placeholder="8,000,000" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t.vacancies.salaryMax}</label>
            <input type="number" value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} placeholder="14,000,000" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t.vacancies.currency}</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${inputCls} bg-white`}>
              {currencies.map((opt) => (
                <option key={opt.code} value={opt.code}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>{t.vacancies.period}</label>
            <select value={salaryPeriod} onChange={(e) => setSalaryPeriod(e.target.value as 'monthly' | 'yearly')} className={`${inputCls} bg-white`}>
              <option value="monthly">{t.vacancies.monthly}</option>
              <option value="yearly">{t.vacancies.yearly}</option>
            </select>
          </div>
        </div>
        {salaryText && <p className="text-[11px] text-[#8B8B8B] mt-2">{salaryText}</p>}
      </div>

      <div className="border-t border-[#EDEDED] pt-4">
        <p className="text-[13px] font-medium text-[#1F114C] mb-3">{t.vacancies.processConfig}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className={labelCls}>{t.vacancies.slaObjectiveLabel}</label>
            <input type="number" value={slaTargetDays} onChange={(e) => setSlaTargetDays(e.target.value)} min={1} max={365} className={inputCls} />
          </div>
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)}
              className="w-4 h-4 rounded border-[#EDEDED] text-[#1F114C] focus:ring-[#1F114C]/20" />
            <div>
              <span className="text-[13px] text-[#333]">{t.vacancies.requireApprovalLabel}</span>
              <p className="text-[10px] text-[#8B8B8B]">{t.vacancies.requireApprovalDesc}</p>
            </div>
          </label>
          <label className={`flex items-center gap-3 ${requireApproval ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
            <input type="checkbox" checked={autoPublish && !requireApproval} disabled={requireApproval}
              onChange={(e) => setAutoPublish(e.target.checked)}
              className="w-4 h-4 rounded border-[#EDEDED] text-[#1F114C] focus:ring-[#1F114C]/20" />
            <div>
              <span className="text-[13px] text-[#333]">{t.vacancies.autoPublishLabel}</span>
              <p className="text-[10px] text-[#8B8B8B]">{t.vacancies.autoPublishDesc}</p>
            </div>
          </label>
          {requireApproval && (
            <p className="text-[11px] text-[#92400e] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {t.vacancies.autoPublishNeedsNoApproval}
            </p>
          )}
        </div>
      </div>

      {/* Summary preview */}
      <div className="border-t border-[#EDEDED] pt-4">
        <p className="text-[13px] font-medium text-[#1F114C] mb-2">{t.vacancies.summaryTitle}</p>
        <div className="bg-[#F6F6F6] rounded-lg p-3 space-y-1.5">
          <div className="flex justify-between">
            <span className="text-[12px] text-[#585858]">{t.vacancies.summaryRoleLabel}</span>
            <span className="text-[12px] text-[#333] font-medium">{title}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[12px] text-[#585858]">{t.vacancies.summaryLocationLabel}</span>
            <span className="text-[12px] text-[#333]">{location || '—'} ({remoteLabel})</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[12px] text-[#585858]">{t.vacancies.summaryContractLabel}</span>
            <span className="text-[12px] text-[#333]">{contractLabel ?? '—'} · {positionCountLabel(positions, t.vacancies)}</span>
          </div>
          {salaryText && (
            <div className="flex justify-between">
              <span className="text-[12px] text-[#585858]">{t.vacancies.summarySalaryLabel}</span>
              <span className="text-[12px] text-[#333]">{salaryText}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
