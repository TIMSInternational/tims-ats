'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { formatRelativeTime } from '../../../../../lib/format-utils';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { AddChannelModal } from './add-channel-modal';
import { Button, StatusBadge } from '../../../../../components';

interface ChannelStats {
  applications?: number;
  qualified?: number;
  costPerQualified?: number;
}

interface Channel {
  id: string;
  channelName: string;
  channelType: string;
  status: string;
  publishedAt: Date | string | null;
  stats: unknown;
}

interface ChannelsCardProps {
  vacancyId: string;
  vacancyStatus: string;
  channels: Channel[];
}

// Monogram tiles are decorative (the channel name is next to them); -700 backgrounds keep white text ≥ 5:1.
const CHANNEL_COLORS: Record<string, { bg: string; text: string }> = {
  linkedin: { bg: 'bg-blue-700', text: 'in' },
  indeed: { bg: 'bg-brand', text: 'ID' },
  computrabajo: { bg: 'bg-orange-700', text: 'CT' },
  elempleo: { bg: 'bg-teal-700', text: 'EE' },
  website: { bg: 'bg-brand', text: 'P' },
  internal: { bg: 'bg-green-700', text: 'R' },
  other: { bg: 'bg-secondary', text: '?' },
};

export function ChannelsCard({ vacancyId, vacancyStatus, channels }: ChannelsCardProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [showAdd, setShowAdd] = useState(false);

  const canPublish = vacancyStatus === 'approved' || vacancyStatus === 'published';
  // Why channels cannot be added, in the card itself (a disabled button's tooltip never reaches touch or keyboard).
  const blockedNote =
    vacancyStatus === 'closed'
      ? t.vacancies.channelsClosedNote
      : vacancyStatus === 'frozen'
        ? t.vacancies.channelsFrozenNote
        : null;

  const publish = trpc.vacancy.publish.useMutation({
    onSuccess: () => {
      utils.vacancy.getById.invalidate({ id: vacancyId });
      utils.vacancy.list.invalidate();
      setShowAdd(false);
      toast(t.vacancies.addChannelSuccess, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  return (
    <section
      aria-labelledby="vacancy-channels-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="vacancy-channels-title" className="text-heading font-semibold text-brand">
          {t.vacancies.channels}
        </h2>
        {canPublish && (
          <Button variant="tertiary" size="sm" onClick={() => setShowAdd(true)}>
            {t.vacancies.addChannelAction}
          </Button>
        )}
      </div>
      {blockedNote && <p className="mb-3 text-callout text-secondary">{blockedNote}</p>}
      <ul className="space-y-2">
        {channels.map((ch) => {
          const color = CHANNEL_COLORS[ch.channelType] ?? CHANNEL_COLORS.other;
          const stats = (ch.stats ?? {}) as ChannelStats;
          return (
            <li
              key={ch.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div
                  aria-hidden="true"
                  className={`flex size-8 shrink-0 items-center justify-center rounded text-caption font-bold text-white ${color.bg}`}
                >
                  {color.text}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-primary">{ch.channelName}</p>
                  {ch.publishedAt && (
                    <p className="text-caption text-secondary">{formatRelativeTime(ch.publishedAt)}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4">
                {stats.applications !== undefined && (
                  <div className="text-right">
                    <p className="text-body font-medium tabular-nums text-brand">{stats.applications}</p>
                    <p className="text-caption text-secondary">{t.vacancies.applications}</p>
                  </div>
                )}
                {stats.qualified !== undefined && (
                  <div className="text-right">
                    <p className="text-body font-medium tabular-nums text-primary">{stats.qualified}</p>
                    <p className="text-caption text-secondary">{t.vacancies.qualified}</p>
                  </div>
                )}
                {stats.costPerQualified !== undefined && (
                  <div className="text-right">
                    <p className="text-body font-medium tabular-nums text-brand">
                      ${stats.costPerQualified.toFixed(2)}
                    </p>
                    <p className="text-caption text-secondary">{t.vacancies.costPerQualified}</p>
                  </div>
                )}
                {ch.status === 'published' ? (
                  <StatusBadge tone="success">{t.vacancies.statusPublished}</StatusBadge>
                ) : ch.status === 'pending' ? (
                  <StatusBadge tone="warning">{t.vacancies.pending}</StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">{t.vacancies.channelStatusUnknown}</StatusBadge>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {showAdd && (
        <AddChannelModal
          onConfirm={(channelName, channelType) => publish.mutate({ vacancyId, channelName, channelType })}
          onClose={() => setShowAdd(false)}
          isPending={publish.isPending}
        />
      )}
    </section>
  );
}
