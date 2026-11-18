'use client';

import { useI18n } from '../../../../../lib/i18n/index';
import { formatDate } from '../../../../../lib/format-utils';
import { buildOfferTimeline, type TimelineOffer, type TimelineTone } from './offer-timeline-entries';

const TONE_CLASS: Record<TimelineTone, string> = {
  brand: 'bg-brand',
  info: 'bg-info',
  success: 'bg-success',
  danger: 'bg-danger',
  muted: 'bg-field-border',
};

export function OfferTimeline({ offer }: { offer: TimelineOffer }) {
  const { t } = useI18n();
  const entries = buildOfferTimeline(offer, t.offers);

  return (
    <section className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5" aria-labelledby="offer-timeline-title">
      <h2 id="offer-timeline-title" className="mb-3 text-heading font-semibold text-brand">{t.offers.offerTimeline}</h2>
      <ol>
        {entries.map((entry, i) => {
          const isLast = i === entries.length - 1;
          return (
            <li key={i} className={`flex gap-3 ${!isLast ? 'pb-3' : ''}`}>
              <div className="flex flex-col items-center">
                <span aria-hidden="true" className={`mt-1 size-2.5 rounded-full ${TONE_CLASS[entry.tone]}`} />
                {!isLast && <span aria-hidden="true" className="w-0.5 flex-1 bg-border" />}
              </div>
              <div className="min-w-0">
                <p className="text-callout text-primary font-medium">{entry.title}</p>
                {entry.detail && (
                  <p className="text-callout text-secondary whitespace-pre-line break-words">{entry.detail}</p>
                )}
                <p className="text-caption text-muted tabular-nums">{entry.at ? formatDate(entry.at) : '—'}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
