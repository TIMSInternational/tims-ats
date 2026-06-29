'use client';

import { trpc } from '../../../../../../lib/trpc';
import { toast } from '../../../../../../lib/toast';
import { useI18n } from '../../../../../../lib/i18n';
import { Skeleton } from '../../../../../../components';

const FEATURE_DESCRIPTIONS: Record<string, string> = {
  ai_cv_parser: 'Parsing automatico de hojas de vida con IA',
  ai_vacancy_writer: 'Generacion de descripciones de vacantes con IA',
  ai_candidate_screener: 'Evaluacion automatica de candidatos',
  ai_interview_questions: 'Generacion de preguntas de entrevista',
  ai_email_composer: 'Composicion automatica de emails',
  advanced_reports: 'Reportes avanzados de reclutamiento',
  multi_language: 'Soporte multi-idioma para vacantes',
  custom_pipelines: 'Pipelines de reclutamiento personalizados',
  sso_enabled: 'Single Sign-On (SAML/OIDC)',
  api_access: 'Acceso a API externa',
};

export function FeaturesSection({ organizationId }: { organizationId: string }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const { data: flagGroups, isLoading } = trpc.platform.listAllFeatureFlags.useQuery();

  const updateFlag = trpc.platform.updateFeatureFlag.useMutation({
    onSuccess: () => {
      utils.platform.listAllFeatureFlags.invalidate();
      toast(t.featureFlags.updated, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message || 'Error al actualizar feature flag', { type: 'error' });
    },
  });

  // Extract flags for this org
  const orgFlags: Array<{ key: string; enabled: boolean }> = [];
  const allKeys = new Set<string>();

  if (flagGroups) {
    for (const group of flagGroups) {
      allKeys.add(group.key);
      const entry = group.entries.find((e) => e.organization?.id === organizationId);
      orgFlags.push({ key: group.key, enabled: entry?.enabled ?? false });
    }
  }

  // Add common keys not yet in DB
  for (const key of Object.keys(FEATURE_DESCRIPTIONS)) {
    if (!allKeys.has(key)) {
      orgFlags.push({ key, enabled: false });
    }
  }

  const handleToggle = (key: string, enabled: boolean) => {
    updateFlag.mutate({ organizationId, key, enabled });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[#333]">{t.featureFlags.title}</h3>

      {isLoading ? (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between animate-pulse">
              <div><Skeleton className="h-4 w-40 mb-1" /><Skeleton className="h-3 w-56" /></div>
              <Skeleton className="h-6 w-11 rounded-full" />
            </div>
          ))}
        </div>
      ) : orgFlags.length === 0 ? (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] py-12 text-center">
          <svg className="w-10 h-10 text-[#EDEDED] mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.208.682l3.454-.863V4.5l-3.454.863a9 9 0 01-6.208-.682l-.108-.054a9 9 0 00-6.208-.682L3 5.25v9.75z" />
          </svg>
          <p className="text-xs text-[#8B8B8B]">{t.featureFlags.noFlags}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] divide-y divide-[#F3F3F3]">
          {orgFlags.map((flag) => (
            <div key={flag.key} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-sm font-medium text-[#333]">{flag.key}</p>
                <p className="text-xs text-[#8B8B8B] mt-0.5">{FEATURE_DESCRIPTIONS[flag.key] || 'Feature flag personalizado'}</p>
              </div>
              <button
                onClick={() => handleToggle(flag.key, !flag.enabled)}
                disabled={updateFlag.isPending}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                  flag.enabled ? 'bg-[#1F114C]' : 'bg-gray-300'
                }`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  flag.enabled ? 'left-[22px]' : 'left-0.5'
                }`} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
