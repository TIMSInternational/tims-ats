'use client';

import { useI18n } from '../../../../../lib/i18n/index';
import { formatDate } from '../../../../../lib/format-utils';

interface TimelineOffer {
  status: string;
  sentAt: Date | string | null;
  createdAt: Date | string;
  creator: { firstName: string; lastName: string } | null;
  approvals: Array<{
    status: string;
    decidedAt: Date | string | null;
    approver: { firstName: string; lastName: string };
  }>;
}

interface OfferTimelineProps {
  offer: TimelineOffer;
}

interface TimelineEntry {
  color: string;
  title: string;
  date: string;
  isLast?: boolean;
}

export function OfferTimeline({ offer }: OfferTimelineProps) {
  const { t } = useI18n();

  const entries: TimelineEntry[] = [];

  // Build timeline entries from newest to oldest
  if (offer.status === 'accepted') {
    entries.push({ color: 'bg-green-500', title: 'Oferta aceptada por el candidato', date: formatDate(offer.sentAt) });
  }
  if (offer.status === 'declined') {
    entries.push({ color: 'bg-red-500', title: 'Oferta rechazada por el candidato', date: formatDate(offer.sentAt) });
  }
  if (offer.sentAt) {
    entries.push({ color: 'bg-blue-500', title: 'Oferta enviada al candidato', date: formatDate(offer.sentAt) });
  }

  // Add approval events (newest first)
  const approvedSteps = offer.approvals
    .filter((a) => a.status === 'approved')
    .sort((a, b) => String(b.decidedAt ?? '').localeCompare(String(a.decidedAt ?? '')));

  for (const step of approvedSteps) {
    entries.push({
      color: 'bg-green-500',
      title: `Aprobada por ${step.approver.firstName} ${step.approver.lastName}`,
      date: step.decidedAt ? formatDate(step.decidedAt) : '—',
    });
  }

  // Creation event is always last
  const creatorName = offer.creator
    ? `${offer.creator.firstName} ${offer.creator.lastName}`
    : 'Sistema';
  entries.push({
    color: 'bg-[#1F114C]',
    title: `Oferta creada por ${creatorName}`,
    date: formatDate(offer.createdAt),
    isLast: true,
  });

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.offers.offerTimeline}</h3>
      <div className="space-y-0">
        {entries.map((entry, i) => (
          <div key={i} className={`flex gap-3 ${!entry.isLast ? 'pb-3' : ''}`}>
            <div className="flex flex-col items-center">
              <div className={`w-2.5 h-2.5 rounded-full ${entry.color} mt-1`} />
              {!entry.isLast && <div className="w-0.5 flex-1 bg-[#EDEDED]" />}
            </div>
            <div>
              <p className="text-[12px] text-[#333] font-medium">{entry.title}</p>
              <p className="text-[10px] text-[#8B8B8B]">{entry.date}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
