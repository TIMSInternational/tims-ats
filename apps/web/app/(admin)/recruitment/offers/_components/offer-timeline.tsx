'use client';

import { useI18n } from '../../../../../lib/i18n/index';
import { formatDate } from '../../../../../lib/format-utils';
import { buildOfferTimeline, type TimelineOffer, type TimelineTone } from './offer-timeline-entries';

const TONE_CLASS: Record<TimelineTone, string> = {
  brand: 'bg-[#1F114C]',
  info: 'bg-blue-500',
  success: 'bg-green-500',
  danger: 'bg-red-500',
  muted: 'bg-[#8B8B8B]',
};

export function OfferTimeline({ offer }: { offer: TimelineOffer }) {
  const { t } = useI18n();
  const entries = buildOfferTimeline(offer, t.offers);

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.offers.offerTimeline}</h3>
      <div className="space-y-0">
        {entries.map((entry, i) => {
          const isLast = i === entries.length - 1;
          return (
            <div key={i} className={`flex gap-3 ${!isLast ? 'pb-3' : ''}`}>
              <div className="flex flex-col items-center">
                <div className={`w-2.5 h-2.5 rounded-full ${TONE_CLASS[entry.tone]} mt-1`} />
                {!isLast && <div className="w-0.5 flex-1 bg-[#EDEDED]" />}
              </div>
              <div className="min-w-0">
                <p className="text-[12px] text-[#333] font-medium">{entry.title}</p>
                {entry.detail && (
                  <p className="text-[11px] text-[#585858] whitespace-pre-line break-words">{entry.detail}</p>
                )}
                <p className="text-[10px] text-[#8B8B8B]">{entry.at ? formatDate(entry.at) : '—'}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
