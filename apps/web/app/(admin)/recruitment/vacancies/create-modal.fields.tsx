'use client';

import { CONTRACT_TYPES, inputCls, labelCls, textareaCls } from './create-modal.helpers';

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
  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Titulo del cargo *</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Senior Software Engineer" maxLength={200} className={inputCls} autoFocus />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Ubicacion</label>
          <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Bogota, Colombia" maxLength={200} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Modalidad de trabajo</label>
          <div className="flex bg-[#F6F6F6] rounded-lg overflow-hidden h-10">
            {(['onsite', 'hybrid', 'remote'] as const).map((opt) => (
              <button key={opt} type="button" onClick={() => setRemotePolicy(opt)}
                className={`flex-1 text-[12px] font-medium transition ${remotePolicy === opt ? 'bg-[#1F114C] text-white' : 'text-[#585858]'}`}>
                {opt === 'onsite' ? 'Presencial' : opt === 'hybrid' ? 'Hibrido' : 'Remoto'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Tipo de contrato</label>
          <select value={contractType} onChange={(e) => setContractType(e.target.value)} className={`${inputCls} bg-white`}>
            {CONTRACT_TYPES.map((ct) => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Posiciones</label>
          <input type="number" value={positions} onChange={(e) => setPositions(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))} min={1} max={100} className={inputCls} />
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className={labelCls}>Prioridad</label>
          <div className="flex bg-[#F6F6F6] rounded-lg overflow-hidden h-10">
            {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
              <button key={p} type="button" onClick={() => setPriority(p)}
                className={`flex-1 text-[11px] font-medium transition ${
                  priority === p
                    ? p === 'urgent' ? 'bg-[#DD0C15] text-white' : 'bg-[#1F114C] text-white'
                    : 'text-[#585858]'
                }`}>
                {p === 'low' ? 'Baja' : p === 'medium' ? 'Media' : p === 'high' ? 'Alta' : 'Urgente'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface Step2Props {
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
}

export function Step2Description({
  description, setDescription, responsibilities, setResponsibilities,
  requirements, setRequirements, desiredQualifications, setDesiredQualifications,
  benefits, setBenefits,
}: Step2Props) {
  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Sobre el cargo</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripcion general del cargo, proposito y contexto del equipo..." maxLength={2000} rows={3} className={textareaCls} autoFocus />
      </div>
      <div>
        <label className={labelCls}>Responsabilidades clave</label>
        <textarea value={responsibilities} onChange={(e) => setResponsibilities(e.target.value)} placeholder="- Disenar y desarrollar soluciones escalables&#10;- Liderar revisiones de codigo&#10;- Colaborar con equipo de producto" maxLength={2000} rows={4} className={textareaCls} />
        <p className="text-[10px] text-[#8B8B8B] mt-1">Usa una linea por responsabilidad</p>
      </div>
      <div>
        <label className={labelCls}>Requisitos minimos</label>
        <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} placeholder="- 5+ anos de experiencia en desarrollo de software&#10;- Ingenieria de Sistemas o afines&#10;- Ingles B2+" maxLength={2000} rows={3} className={textareaCls} />
      </div>
      <div>
        <label className={labelCls}>Cualificaciones deseadas</label>
        <textarea value={desiredQualifications} onChange={(e) => setDesiredQualifications(e.target.value)} placeholder="- Experiencia con AWS/GCP&#10;- Certificaciones relevantes&#10;- Experiencia en startups" maxLength={2000} rows={2} className={textareaCls} />
      </div>
      <div>
        <label className={labelCls}>Beneficios</label>
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
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[13px] font-medium text-[#1F114C] mb-3">Rango salarial</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className={labelCls}>Minimo</label>
            <input type="number" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} placeholder="8,000,000" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Maximo</label>
            <input type="number" value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} placeholder="14,000,000" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Moneda</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${inputCls} bg-white`}>
              <option value="COP">COP</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="MXN">MXN</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Periodo</label>
            <select value={salaryPeriod} onChange={(e) => setSalaryPeriod(e.target.value as 'monthly' | 'yearly')} className={`${inputCls} bg-white`}>
              <option value="monthly">Mensual</option>
              <option value="yearly">Anual</option>
            </select>
          </div>
        </div>
        {salaryMin && salaryMax && (
          <p className="text-[11px] text-[#8B8B8B] mt-2">
            {currency} {parseInt(salaryMin).toLocaleString()} — {parseInt(salaryMax).toLocaleString()} / {salaryPeriod === 'monthly' ? 'mes' : 'ano'}
          </p>
        )}
      </div>

      <div className="border-t border-[#EDEDED] pt-4">
        <p className="text-[13px] font-medium text-[#1F114C] mb-3">Configuracion del proceso</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className={labelCls}>SLA objetivo (dias)</label>
            <input type="number" value={slaTargetDays} onChange={(e) => setSlaTargetDays(e.target.value)} min={1} max={365} className={inputCls} />
          </div>
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)}
              className="w-4 h-4 rounded border-[#EDEDED] text-[#1F114C] focus:ring-[#1F114C]/20" />
            <div>
              <span className="text-[13px] text-[#333]">Requiere aprobacion</span>
              <p className="text-[10px] text-[#8B8B8B]">La vacante debe ser aprobada antes de publicarse</p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={autoPublish} onChange={(e) => setAutoPublish(e.target.checked)}
              className="w-4 h-4 rounded border-[#EDEDED] text-[#1F114C] focus:ring-[#1F114C]/20" />
            <div>
              <span className="text-[13px] text-[#333]">Publicar automaticamente</span>
              <p className="text-[10px] text-[#8B8B8B]">Publicar en portal de empleo al ser aprobada</p>
            </div>
          </label>
        </div>
      </div>

      {/* Summary preview */}
      <div className="border-t border-[#EDEDED] pt-4">
        <p className="text-[13px] font-medium text-[#1F114C] mb-2">Resumen</p>
        <div className="bg-[#F6F6F6] rounded-lg p-3 space-y-1.5">
          <div className="flex justify-between">
            <span className="text-[12px] text-[#585858]">Cargo:</span>
            <span className="text-[12px] text-[#333] font-medium">{title}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[12px] text-[#585858]">Ubicacion:</span>
            <span className="text-[12px] text-[#333]">{location || '—'} ({remotePolicy === 'onsite' ? 'Presencial' : remotePolicy === 'hybrid' ? 'Hibrido' : 'Remoto'})</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[12px] text-[#585858]">Contrato:</span>
            <span className="text-[12px] text-[#333]">{CONTRACT_TYPES.find((c) => c.value === contractType)?.label} · {positions} posicion(es)</span>
          </div>
          {(salaryMin || salaryMax) && (
            <div className="flex justify-between">
              <span className="text-[12px] text-[#585858]">Salario:</span>
              <span className="text-[12px] text-[#333]">{currency} {salaryMin ? parseInt(salaryMin).toLocaleString() : '?'} — {salaryMax ? parseInt(salaryMax).toLocaleString() : '?'}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
