'use client';

import { useI18n } from '../../../../../lib/i18n';

interface RiskItem {
  id: string;
  title: string;
  description: string;
}

// TODO: wire to API when risk detection is implemented
// For now, renders a placeholder when no risks are available
export function RiskFlags({ risks }: { risks?: RiskItem[] }) {
  const { t } = useI18n();

  if (!risks || risks.length === 0) return null;

  return (
    <section className="rounded-xl border border-warning/40 bg-white p-4 shadow-card md:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-heading font-semibold text-brand">
        <svg
          className="size-4 text-warning"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        {t.candidates.riskFlags}
      </h2>
      <ul className="space-y-2">
        {risks.map((risk) => (
          <li key={risk.id} className="flex items-start gap-2">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
            <span className="text-body text-secondary">
              <strong className="text-primary">{risk.title}:</strong> {risk.description}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
