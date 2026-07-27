'use client';

import { useI18n } from '../../../../lib/i18n';
import { useEngagementLowClimateAlerts } from '../../../../lib/platform-api/engagement';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-[13px] font-semibold text-[#333] mb-3">{title}</h3>
      {children}
    </div>
  );
}

// Word cloud + sentiment require an NLP service (getWordCloud/getSentiment are
// stubs). Render explicit unavailable states rather than fabricated data (rule #4).
export function WordCloud() {
  const { t } = useI18n();
  return (
    <Card title={t.climate.wordCloud}>
      <p className="text-[12px] text-[#8B8B8B] py-4 text-center">{t.climate.wordCloudUnavailable}</p>
    </Card>
  );
}

export function SentimentAnalysis() {
  const { t } = useI18n();
  return (
    <Card title={t.climate.sentiment}>
      <p className="text-[12px] text-[#8B8B8B] py-4 text-center">{t.climate.sentimentUnavailable}</p>
    </Card>
  );
}

function severityClasses(sev: string): { wrap: string; badge: string } {
  const s = sev.toLowerCase();
  if (s === 'critical' || s === 'critico' || s === 'high' || s === 'alto') {
    return { wrap: 'bg-red-50 border-red-100', badge: 'text-red-600 bg-red-100' };
  }
  return { wrap: 'bg-amber-50 border-amber-100', badge: 'text-amber-600 bg-amber-100' };
}

export function LowClimateAlerts() {
  const { t } = useI18n();
  const q = useEngagementLowClimateAlerts();

  return (
    <Card title={t.climate.lowAlerts}>
      {q.isLoading ? (
        <div className="h-20 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{t.climate.errAlerts}</p>
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.climate.noAlerts}</p>
      ) : (
        <div className="space-y-2">
          {q.data.map((a) => {
            const c = severityClasses(a.severity);
            return (
              <div key={a.id} className={`flex items-center justify-between p-2.5 rounded-lg border ${c.wrap}`}>
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-[#333] truncate">{a.title}</p>
                  <p className="text-[10px] text-[#8B8B8B] truncate">{a.message}</p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${c.badge}`}>
                  {a.severity}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
