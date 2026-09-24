'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import {
  useProctoringMedia, useProctoringMediaReadGrant,
  type ProctoringMediaItem,
} from '../../../../../lib/platform-api/proctoring-staff';

interface ProctoringMediaReviewProps {
  assignmentId: string;
}

type ReadGrant = { evidenceId: string; url: string; expiresAt: string };

export function ProctoringMediaReview({ assignmentId }: ProctoringMediaReviewProps) {
  const { t, locale } = useI18n();
  const labels = t.proctoring.review.media;
  const media = useProctoringMedia(assignmentId);
  const read = useProctoringMediaReadGrant();
  const [grant, setGrant] = useState<ReadGrant | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const formatTime = (value: string) => new Intl.DateTimeFormat(
    locale === 'ES' ? 'es' : 'en', { dateStyle: 'medium', timeStyle: 'short' },
  ).format(new Date(value));

  useEffect(() => {
    if (!grant) return;
    const remaining = Date.parse(grant.expiresAt) - Date.now();
    const timer = window.setTimeout(() => setGrant(null), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [grant]);

  const open = (item: ProctoringMediaItem) => {
    setSelectedId(item.evidenceId);
    setGrant(null);
    read.mutate({ assignmentId, evidenceId: item.evidenceId }, {
      onSuccess: (result) => setGrant(result),
    });
  };

  const viewable = (item: ProctoringMediaItem) =>
    ['ready', 'processing', 'processed', 'unavailable'].includes(item.status)
    && item.expiresAt !== null;

  const findingText = (finding: ProctoringMediaItem['findings'][number]) => {
    if (finding.resultKind === 'unavailable') return labels.unavailable;
    const name = finding.label === 'face_count' ? labels.faceCount
      : finding.label === 'person' ? labels.person
        : finding.label === 'cell_phone' ? labels.cellPhone : finding.label;
    return `${name}: ${finding.detectedCount ?? 0}`;
  };

  return (
    <section className="space-y-3 rounded-lg border border-[#EDEDED] bg-white p-3">
      <h3 className="font-semibold text-[#1F114C]">{labels.title}</h3>
      <p className="text-[11px] text-[#585858]">{labels.notProof}</p>
      {media.isLoading ? <p role="status">{labels.loading}</p> : null}
      {media.isError ? <p role="alert" className="text-[#B42318]">{labels.loadError}</p> : null}
      {media.data && !media.data.mediaConsented ? (
        <p role="status">{labels.consentNotGiven}</p>
      ) : null}
      {media.data?.mediaConsented && media.data.items.length === 0 ? <p>{labels.empty}</p> : null}
      {media.data && media.data.items.length > 0 ? (
        <ol className="max-h-72 space-y-2 overflow-y-auto">
          {media.data.items.map((item) => (
            <li key={item.evidenceId} className="rounded border border-[#EDEDED] p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-[#1F114C]">
                  {item.mediaType === 'camera' ? labels.camera : labels.screen}
                  {' · '}
                  {item.captureReason === 'periodic' ? labels.periodic : labels.event}
                </p>
                <span>{labels.captured}: {formatTime(item.createdAt)}</span>
              </div>
              {item.findings.length > 0 ? (
                <ul className="mt-1 flex flex-wrap gap-1">
                  {item.findings.map((finding) => (
                    <li key={`${finding.detector}:${finding.label}`}
                      className="rounded bg-[#F4F0FB] px-2 py-1 text-[#1F114C]">
                      {findingText(finding)}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-[#585858]">
                {item.status === 'unavailable' ? labels.unavailable : labels.noFindings}
              </p>}
              {viewable(item) ? (
                <button type="button" disabled={read.isPending}
                  onClick={() => open(item)}
                  className="mt-2 rounded border border-[#1F114C] px-2 py-1 font-medium text-[#1F114C] disabled:opacity-50">
                  {selectedId === item.evidenceId && read.isPending ? labels.viewing : labels.view}
                </button>
              ) : <p className="mt-2 text-[#585858]">{labels.expired}</p>}
              {selectedId === item.evidenceId && read.isError ? (
                <p role="alert" className="mt-1 text-[#B42318]">{labels.viewError}</p>
              ) : null}
              {selectedId === item.evidenceId && grant?.evidenceId === item.evidenceId ? (
                // The reviewer requested this short-lived, audited URL. It is not
                // sent through Next's image optimizer or to another origin.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={grant.url} referrerPolicy="no-referrer"
                  alt={`${item.mediaType === 'camera' ? labels.camera : labels.screen} · ${formatTime(item.createdAt)}`}
                  className="mt-2 max-h-96 w-full rounded border border-[#EDEDED] object-contain"
                  onError={() => setGrant(null)} />
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
