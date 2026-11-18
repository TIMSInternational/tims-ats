import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '../../../apps/web/lib/i18n';
import { VacancyAssessmentsCard } from '../../../apps/web/app/(admin)/recruitment/vacancies/[id]/vacancy-assessments-card';
import { ProviderAssessmentsCard } from '../../../apps/web/app/(admin)/recruitment/candidates/[id]/provider-assessments-card';
import { AssessmentProviderSection } from '../../../apps/web/app/(admin)/platform/organizations/[id]/sections/assessment-provider-section';

// ?view=vacancy | candidate | platform. The ids are fixed; the spec's mocked provider answers for them.
const params = new URLSearchParams(window.location.search);
const VACANCY = '7ac00000-0000-4000-8000-000000000001';
const CANDIDATE = 'ca000000-0000-4000-8000-000000000001';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <I18nProvider>
      <main>
        {params.get('view') === 'platform' ? (
          <AssessmentProviderSection
            organizationId="0a000000-0000-4000-8000-000000000001"
            organizationName="Acme Corp"
          />
        ) : params.get('view') === 'candidate' ? (
          <ProviderAssessmentsCard
            candidateId={CANDIDATE}
            applications={[{ status: 'active', vacancy: { id: VACANCY, title: 'Data Analyst' } }]}
          />
        ) : (
          <VacancyAssessmentsCard vacancyId={VACANCY} />
        )}
      </main>
    </I18nProvider>
  </QueryClientProvider>,
);
