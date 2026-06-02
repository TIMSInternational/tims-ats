'use client';

import { useI18n } from '../../../../../lib/i18n';
import { formatRelativeTime } from '../../../../../lib/format-utils';

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
  channels: Channel[];
}

const CHANNEL_COLORS: Record<string, { bg: string; text: string }> = {
  linkedin: { bg: 'bg-blue-600', text: 'in' },
  indeed: { bg: 'bg-[#1F114C]', text: 'ID' },
  computrabajo: { bg: 'bg-orange-500', text: 'CT' },
  elempleo: { bg: 'bg-teal-600', text: 'EE' },
  website: { bg: 'bg-[#1F114C]', text: 'P' },
  internal: { bg: 'bg-green-600', text: 'R' },
  other: { bg: 'bg-gray-500', text: '?' },
};

export function ChannelsCard({ channels }: ChannelsCardProps) {
  const { t } = useI18n();

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.vacancies.channels}</h3>
        <button className="text-[12px] text-[#DD0C15] font-medium">+ {t.vacancies.addChannel}</button>
      </div>
      <div className="space-y-2">
        {channels.map((ch) => {
          const color = CHANNEL_COLORS[ch.channelType] ?? CHANNEL_COLORS.other;
          const stats = (ch.stats ?? {}) as ChannelStats;
          return (
            <div key={ch.id} className="flex items-center justify-between bg-[#F6F6F6] rounded-lg px-4 py-3">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded ${color.bg} flex items-center justify-center text-white text-[10px] font-bold`}>
                  {color.text}
                </div>
                <div>
                  <p className="text-[12px] text-[#333] font-medium">{ch.channelName}</p>
                  {ch.publishedAt && (
                    <p className="text-[10px] text-[#8B8B8B]">{formatRelativeTime(ch.publishedAt)}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4">
                {stats.applications !== undefined && (
                  <div className="text-right">
                    <p className="text-[13px] font-medium text-[#1F114C]">{stats.applications}</p>
                    <p className="text-[10px] text-[#8B8B8B]">{t.vacancies.applications}</p>
                  </div>
                )}
                {stats.qualified !== undefined && (
                  <div className="text-right">
                    <p className="text-[13px] font-medium text-green-600">{stats.qualified}</p>
                    <p className="text-[10px] text-[#8B8B8B]">{t.vacancies.qualified}</p>
                  </div>
                )}
                {stats.costPerQualified !== undefined && (
                  <div className="text-right">
                    <p className="text-[13px] font-medium text-[#1F114C]">${stats.costPerQualified.toFixed(2)}</p>
                    <p className="text-[10px] text-[#8B8B8B]">{t.vacancies.costPerQualified}</p>
                  </div>
                )}
                <span className={`text-[10px] px-2 py-0.5 rounded ${
                  ch.status === 'published' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-600'
                }`}>
                  {ch.status === 'published' ? t.vacancies.statusPublished : ch.status}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
