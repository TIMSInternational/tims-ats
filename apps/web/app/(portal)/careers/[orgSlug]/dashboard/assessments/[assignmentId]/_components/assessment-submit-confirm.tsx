'use client';

import { useI18n } from '../../../../../../../../lib/i18n';

interface AssessmentSubmitConfirmProps {
  unansweredOrders: number[];
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AssessmentSubmitConfirm({
  unansweredOrders,
  isSubmitting,
  onConfirm,
  onCancel,
}: AssessmentSubmitConfirmProps) {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-lg p-6 max-w-md w-full space-y-4">
        <h2 className="text-base font-semibold text-[#1F114C]">{t.assessmentPlayer.submitConfirmTitle}</h2>
        {unansweredOrders.length > 0 && (
          <p className="text-[13px] text-[#B45309]">
            {t.assessmentPlayer.submitConfirmUnansweredPrefix} {unansweredOrders.join(', ')}
          </p>
        )}
        <p className="text-[13px] text-[#585858]">{t.assessmentPlayer.submitConfirmBody}</p>
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 h-10 rounded-xl border border-[#E5E5E5] text-[13px] font-medium text-[#585858] hover:bg-[#FAFAFA] disabled:opacity-40"
          >
            {t.assessmentPlayer.submitConfirmCancelButton}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="flex-1 h-10 rounded-xl bg-[#1F114C] text-white text-[13px] font-semibold hover:bg-[#2a1a5e] disabled:opacity-40"
          >
            {isSubmitting ? t.assessmentPlayer.submitConfirmSubmitting : t.assessmentPlayer.submitConfirmConfirmButton}
          </button>
        </div>
      </div>
    </div>
  );
}
