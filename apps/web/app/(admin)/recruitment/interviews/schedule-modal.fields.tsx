'use client';

import type { AppRouter } from '@tims/api';
import type { inferRouterOutputs } from '@trpc/server';
import type { UseTRPCQueryResult } from '@trpc/react-query/shared';
import type { TRPCClientErrorLike } from '@trpc/client';
import { CandidateAvatar, ErrorState } from '../../../../components';
import Link from 'next/link';
import { availableInterviewTypes, DURATIONS, locationPlaceholderKey } from './schedule-modal.helpers';
import { FIELD_HELP_CLASSES, FIELD_LABEL_CLASSES, inputClasses, selectClasses } from '../../../../components/field-styles';
import { TEXT_LINK_CLASSES } from '../../../../components/button-styles';
import { InterviewTypeIcon } from './interview-type-icon';
import { useI18n } from '../../../../lib/i18n';

type RouterOutput = inferRouterOutputs<AppRouter>;
type ClientError = TRPCClientErrorLike<AppRouter>;

type CandidateSearchResult = UseTRPCQueryResult<RouterOutput['candidate']['search'], ClientError>;
type VacancyListResult = UseTRPCQueryResult<RouterOutput['vacancy']['list'], ClientError>;

interface Step1FieldsProps {
  candidates: CandidateSearchResult;
  candidateSearch: string;
  setCandidateSearch: (value: string) => void;
  selectedCandidateId: string;
  setSelectedCandidateId: (value: string) => void;
  selectedCandidateName: string;
  setSelectedCandidateName: (value: string) => void;
  vacancies: VacancyListResult;
  selectedVacancyId: string;
  setSelectedVacancyId: (value: string) => void;
  setSelectedVacancyTitle: (value: string) => void;
}

const CHECK = (
  <svg className="size-4 shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const choiceClasses = (selected: boolean) =>
  `w-full text-left rounded-lg border transition-colors pointer-coarse:min-h-11 ${
    selected ? 'border-brand bg-brand-tint text-brand' : 'border-border text-primary hover:bg-surface'
  }`;

export function Step1Fields({
  candidates,
  candidateSearch,
  setCandidateSearch,
  selectedCandidateId,
  setSelectedCandidateId,
  selectedCandidateName,
  setSelectedCandidateName,
  vacancies,
  selectedVacancyId,
  setSelectedVacancyId,
  setSelectedVacancyTitle,
}: Step1FieldsProps) {
  const { t } = useI18n();
  const vacancyItems = vacancies.data?.items ?? [];
  return (
    <div className="space-y-5">
      {/* Candidate search */}
      <div>
        <label htmlFor="schedule-candidate" className={FIELD_LABEL_CLASSES}>{t.interviews.scheduleFieldCandidate}</label>
        {selectedCandidateId ? (
          <div className="flex items-center gap-3 rounded-lg bg-brand-tint px-3 py-2.5">
            <div className="flex size-8 items-center justify-center rounded-full bg-brand text-caption font-semibold text-white" aria-hidden="true">
              {selectedCandidateName.split(' ').map((p) => p[0]).join('').slice(0, 2)}
            </div>
            <span id="schedule-candidate" className="flex-1 text-body font-medium text-brand">{selectedCandidateName}</span>
            <button
              type="button"
              onClick={() => { setSelectedCandidateId(''); setSelectedCandidateName(''); setCandidateSearch(''); }}
              className={TEXT_LINK_CLASSES}
            >
              {t.common.change}
            </button>
          </div>
        ) : (
          <div>
            <input id="schedule-candidate" type="text" value={candidateSearch} onChange={(e) => setCandidateSearch(e.target.value)}
              placeholder={t.interviews.scheduleFieldCandidatePlaceholder} className={inputClasses()} autoFocus />
            {candidateSearch.length > 0 && (
              <div className="mt-1 max-h-[180px] overflow-y-auto rounded-lg border border-border bg-white shadow-card">
                {candidates.isLoading && <p className="px-3 py-2 text-callout text-muted">{t.nav.searching}</p>}
                {candidates.isError && <ErrorState onRetry={() => candidates.refetch()} size="inline" />}
                {!candidates.isLoading && !candidates.isError && candidates.data?.length === 0 && <p className="px-3 py-2 text-callout text-muted">{t.interviews.scheduleFieldNoResults}</p>}
                {!candidates.isError && (candidates.data ?? []).map((c) => (
                  <button key={c.id} type="button" onClick={() => { setSelectedCandidateId(c.id); setSelectedCandidateName(`${c.firstName} ${c.lastName}`); setCandidateSearch(''); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface pointer-coarse:min-h-11">
                    <CandidateAvatar firstName={c.firstName} lastName={c.lastName} avatar={null} size="sm" decorative />
                    <div>
                      <p className="text-callout font-medium text-primary">{c.firstName} {c.lastName}</p>
                      <p className="text-caption text-muted">{c.email}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Vacancy selector: a single-choice group of buttons, the chosen one aria-pressed and checked. */}
      <div>
        <p id="schedule-vacancy-label" className={FIELD_LABEL_CLASSES}>{t.interviews.scheduleFieldVacancy}</p>
        <div role="group" aria-labelledby="schedule-vacancy-label" className="max-h-[200px] space-y-1.5 overflow-y-auto">
          {vacancies.isError ? (
            <ErrorState onRetry={() => vacancies.refetch()} size="compact" />
          ) : (
            vacancyItems.map((v) => {
              const selected = selectedVacancyId === v.id;
              return (
                <button key={v.id} type="button" aria-pressed={selected}
                  onClick={() => { setSelectedVacancyId(v.id); setSelectedVacancyTitle(v.title); }}
                  className={`${choiceClasses(selected)} flex items-center gap-2 px-3 py-2.5 text-callout ${selected ? 'font-medium' : ''}`}>
                  <span className="min-w-0 flex-1">
                    {v.title}
                    {v.location && <span className="ml-2 text-caption text-muted">· {v.location}</span>}
                  </span>
                  {selected && CHECK}
                </button>
              );
            })
          )}
          {vacancies.isLoading && <p className="py-2 text-callout text-muted">{t.interviews.scheduleFieldLoadingVacancies}</p>}
          {!vacancies.isLoading && !vacancies.isError && vacancyItems.length === 0 && (
            <p className="py-2 text-callout text-secondary">
              {t.interviews.scheduleNoPublishedVacancies}{' '}
              <Link href="/recruitment/vacancies" className={TEXT_LINK_CLASSES}>{t.interviews.scheduleGoToVacancies}</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface Step2FieldsProps {
  interviewType: string;
  setInterviewType: (value: string) => void;
  scheduledDate: string;
  setScheduledDate: (value: string) => void;
  scheduledTime: string;
  setScheduledTime: (value: string) => void;
  duration: number;
  setDuration: (value: number) => void;
  location: string;
  setLocation: (value: string) => void;
  /** "hora de Costa Rica (GMT-6)": the zone the typed time is booked and emailed in. */
  timeZoneLabel: string;
  /** True when the organization has no zone and the time falls back to UTC. */
  isUtcFallback: boolean;
}

export function Step2Fields({
  interviewType,
  setInterviewType,
  scheduledDate,
  setScheduledDate,
  scheduledTime,
  setScheduledTime,
  duration,
  setDuration,
  location,
  setLocation,
  timeZoneLabel,
  isUtcFallback,
}: Step2FieldsProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      <div>
        <p id="schedule-type-label" className={FIELD_LABEL_CLASSES}>{t.interviews.scheduleFieldInterviewType}</p>
        <div role="group" aria-labelledby="schedule-type-label" className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
          {availableInterviewTypes().map((it) => {
            const selected = interviewType === it.value;
            return (
              <button key={it.value} type="button" aria-pressed={selected} onClick={() => setInterviewType(it.value)}
                className={`${choiceClasses(selected)} px-3 py-3`}>
                <span className="mb-1 flex items-center gap-2">
                  <InterviewTypeIcon type={it.value} className="size-4" />
                  <span className="flex-1 text-callout font-medium">{t.interviews[it.labelKey]}</span>
                  {selected && CHECK}
                </span>
                <span className="block text-caption text-secondary">{t.interviews[it.descKey]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="schedule-date" className={FIELD_LABEL_CLASSES}>{t.interviews.scheduleFieldDate}</label>
          <input id="schedule-date" type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className={inputClasses()} required />
        </div>
        <div>
          <label htmlFor="schedule-time" className={FIELD_LABEL_CLASSES}>{t.interviews.scheduleFieldTime}</label>
          <input id="schedule-time" type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} className={inputClasses()} aria-describedby="schedule-time-zone" required />
          <p id="schedule-time-zone" className={FIELD_HELP_CLASSES}>
            {t.interviews.scheduleTimeZoneHint.replace('{zone}', () => timeZoneLabel)}
          </p>
        </div>
        <div>
          <label htmlFor="schedule-duration" className={FIELD_LABEL_CLASSES}>{t.interviews.scheduleFieldDuration}</label>
          <select id="schedule-duration" value={duration} onChange={(e) => setDuration(parseInt(e.target.value))} className={selectClasses()}>
            {DURATIONS.map((d) => <option key={d.value} value={d.value}>{t.interviews[d.labelKey]}</option>)}
          </select>
        </div>
      </div>
      {isUtcFallback && <p role="note" className="-mt-3 text-callout text-warning">{t.interviews.scheduleTimeZoneUtcWarning}</p>}

      <div>
        <label htmlFor="schedule-location" className={FIELD_LABEL_CLASSES}>{t.interviews.scheduleFieldLocationLink}</label>
        <input id="schedule-location" type="text" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={500} className={inputClasses()}
          placeholder={t.interviews[locationPlaceholderKey(interviewType)]} aria-describedby={interviewType === 'video' && !location ? 'schedule-location-help' : undefined} />
        {interviewType === 'video' && !location && (
          <p id="schedule-location-help" className="mt-1.5 text-callout text-info">{t.interviews.scheduleFieldVideoAutoRoom}</p>
        )}
      </div>
    </div>
  );
}
