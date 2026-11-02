'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import {
  isVacancyIdShape,
  resolveInitialVacancy,
  type InitialVacancyDecision,
  type PipelineVacancyOption,
  type RequestedVacancyLookup,
} from './pipeline-vacancy-select';

/**
 * Owns the pipeline's vacancy selection: the published-vacancy list, the `?vacancy=` deep link
 * (looked up separately when it is outside the loaded page), and the fallback notice.
 */
export function usePipelineVacancySelection(requestedId: string | null) {
  const vacancies = trpc.vacancy.list.useQuery({ limit: 50, status: 'published' });
  const list: PipelineVacancyOption[] = vacancies.data?.items ?? [];

  const needsLookup = vacancies.isSuccess && !!requestedId && !list.some((v) => v.id === requestedId);
  const canLookup = needsLookup && !!requestedId && isVacancyIdShape(requestedId);
  // vacancy.getById is org- and scope-filtered server-side: a hit means the user may open it.
  const requested = trpc.vacancy.getById.useQuery({ id: requestedId ?? '' }, { enabled: canLookup, retry: false });

  const lookup: RequestedVacancyLookup = !canLookup || requested.isError
    ? { status: 'unavailable' }
    : requested.data
      ? { status: 'found', vacancy: requested.data }
      : { status: 'loading' };

  const [picked, setPicked] = useState<string | null>(null);
  const [initial, setInitial] = useState<InitialVacancyDecision | null>(null);
  if (!initial && vacancies.isSuccess) {
    const decision = resolveInitialVacancy(list, requestedId, lookup);
    if (decision) setInitial(decision);
  }

  const found = lookup.status === 'found' ? lookup.vacancy : null;
  const extra = found && !list.some((v) => v.id === found.id) ? found : null;
  const options = extra ? [extra, ...list] : list;
  const selectedVacancyId = picked ?? initial?.id ?? null;

  return {
    vacancies,
    options,
    selectedVacancyId,
    setSelectedVacancyId: setPicked,
    isLoading: vacancies.isLoading || lookup.status === 'loading',
    showUnavailableNotice: !!initial?.notice && picked === null,
  };
}
