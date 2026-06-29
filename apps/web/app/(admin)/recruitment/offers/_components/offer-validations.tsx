'use client';

import { useI18n } from '../../../../../lib/i18n/index';
import { formatDate } from '../../../../../lib/format-utils';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';

interface Validation {
  id: string;
  type: string;
  status: string;
  isBlocking: boolean;
  completedAt: Date | string | null;
  notes: string | null;
  completedByUser: { id: string; firstName: string; lastName: string } | null;
}

interface LegalCheck {
  id: string;
  checkName: string;
  completed: boolean;
  completedAt: Date | string | null;
  completedByUser: { id: string; firstName: string; lastName: string } | null;
}

interface OfferValidationsProps {
  offerId: string;
  validations: Validation[];
  legalChecks: LegalCheck[];
}

const TYPE_LABELS: Record<string, string> = {
  offer_accepted: 'Oferta Aceptada',
  background_check: 'Verificacion de Antecedentes',
  reference_check: 'Verificacion de Referencias',
  medical_exam: 'Examen Medico',
  education_verification: 'Verificacion de Educacion',
  contract_signing: 'Firma de Contrato',
};

function ValidationItem({ validation }: { validation: Validation }) {
  const { t } = useI18n();
  const isPassed = validation.status === 'passed';
  const isPending = validation.status === 'pending';
  const isInReview = validation.status === 'in_review' || validation.status === 'in_progress';

  const bgCls = isPassed
    ? 'bg-green-50 border-green-200'
    : isInReview
      ? 'bg-amber-50 border-amber-200'
      : 'bg-[#F6F6F6] border-[#EDEDED]';

  const iconCls = isPassed
    ? 'bg-green-500'
    : isInReview
      ? 'bg-amber-500'
      : 'bg-[#EDEDED]';

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${bgCls} mb-2`}>
      <div className={`w-6 h-6 rounded-full ${iconCls} flex items-center justify-center shrink-0 mt-0.5`}>
        {isPassed ? (
          <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        ) : isInReview ? (
          <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
      </div>
      <div className="flex-1">
        <div className="flex justify-between items-center">
          <p className={`text-[12px] font-medium ${isPending ? 'text-[#8B8B8B]' : 'text-[#333]'}`}>
            {TYPE_LABELS[validation.type] || validation.type}
          </p>
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
              validation.isBlocking
                ? 'bg-[#DD0C15]/10 text-[#DD0C15]'
                : 'bg-[#F6F6F6] text-[#8B8B8B] border border-[#EDEDED]'
            }`}
          >
            {validation.isBlocking ? t.offers.blocking : t.offers.nonBlocking}
          </span>
        </div>
        {isPassed && validation.completedAt && (
          <p className="text-[10px] text-green-600 mt-0.5">
            {t.offers.completed} — {formatDate(validation.completedAt)}
            {validation.completedByUser && ` — ${validation.completedByUser.firstName} ${validation.completedByUser.lastName}`}
          </p>
        )}
        {isInReview && (
          <p className="text-[10px] text-amber-600 mt-0.5 font-medium">
            {t.offers.inReview}
          </p>
        )}
        {isPending && (
          <p className="text-[10px] text-[#8B8B8B] mt-0.5">{t.offers.pending}</p>
        )}
        {validation.notes && (
          <p className="text-[10px] text-[#8B8B8B] mt-0.5">{validation.notes}</p>
        )}
      </div>
    </div>
  );
}

function LegalCheckItem({
  check,
  offerId,
}: {
  check: LegalCheck;
  offerId: string;
}) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const updateCheck = trpc.offer.updateLegalCheck.useMutation({
    onSuccess: () => {
      utils.offer.getLegalChecklist.invalidate({ offerId });
      utils.offer.getById.invalidate({ id: offerId });
    },
    onError: () => toast(t.offers.errorUpdateVerification, { type: 'error' }),
  });

  return (
    <div
      className="flex items-center gap-2 cursor-pointer"
      onClick={() => updateCheck.mutate({ id: check.id, completed: !check.completed })}
    >
      {check.completed ? (
        <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      ) : (
        <svg className="w-4 h-4 text-[#EDEDED] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" />
        </svg>
      )}
      <span className={`text-[11px] ${check.completed ? 'text-[#333]' : 'text-[#8B8B8B]'}`}>
        {check.checkName}
      </span>
    </div>
  );
}

export function OfferValidations({ offerId, validations, legalChecks }: OfferValidationsProps) {
  const { t } = useI18n();

  const completedValidations = validations.filter((v) => v.status === 'passed').length;
  const totalValidations = validations.length;
  const completedLegal = legalChecks.filter((c) => c.completed).length;
  const totalLegal = legalChecks.length;

  return (
    <div className="space-y-4">
      {/* Validation Checklist */}
      <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.offers.validationChecklist}</h3>
          <span className="text-[11px] text-[#585858]">
            {completedValidations} {t.offers.ofCompleted.split(' ')[0]} {totalValidations} {t.offers.ofCompleted}
          </span>
        </div>
        {validations.map((v) => (
          <ValidationItem key={v.id} validation={v} />
        ))}
        {validations.length === 0 && (
          <p className="text-[12px] text-[#8B8B8B] text-center py-4">
            No hay validaciones configuradas para esta oferta
          </p>
        )}
      </div>

      {/* Legal Checklist */}
      {legalChecks.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.offers.legalChecklist}</h3>
            <span className="text-[10px] bg-[#F6F6F6] text-[#585858] px-2 py-0.5 rounded">
              {t.offers.autoLoadedByCountry}
            </span>
          </div>
          <div className="space-y-1.5">
            {legalChecks.map((check) => (
              <LegalCheckItem key={check.id} check={check} offerId={offerId} />
            ))}
          </div>
          <p className="text-[10px] text-[#8B8B8B] mt-3 pt-3 border-t border-[#F0F0F0]">
            {completedLegal} de {totalLegal} {t.offers.itemsCompleted} — {t.offers.managedInOnboarding}
          </p>
        </div>
      )}

      {/* Audit Trail */}
      <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.offers.auditTrail}</h3>
        <div className="space-y-1.5">
          {validations
            .filter((v) => v.completedAt)
            .sort((a, b) => String(b.completedAt ?? '').localeCompare(String(a.completedAt ?? '')))
            .map((v) => (
              <div key={v.id} className="flex items-center gap-3 text-[10px]">
                <span className="text-[#8B8B8B] w-28 shrink-0">{formatDate(v.completedAt)}</span>
                <span className="text-[#333]">
                  {v.completedByUser
                    ? `${v.completedByUser.firstName} ${v.completedByUser.lastName}`
                    : 'Sistema'}{' '}
                  — {TYPE_LABELS[v.type] || v.type}: {v.status}
                </span>
              </div>
            ))}
          {validations.filter((v) => v.completedAt).length === 0 && (
            <p className="text-[11px] text-[#8B8B8B] text-center py-2">{t.offers.noAuditEvents}</p>
          )}
        </div>
      </div>
    </div>
  );
}
