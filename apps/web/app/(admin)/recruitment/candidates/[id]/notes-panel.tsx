'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { useI18n } from '../../../../../lib/i18n';
import { useCan } from '../../../../../lib/permissions';

/** candidate.update bounds `notes` to 5000 characters. */
const NOTES_MAX = 5000;

/**
 * The candidate's general notes (journeys-27): a single shared text the recruiting team can now edit through
 * the existing candidate.update (candidate:update). Read-only for everyone else.
 */
export function CandidateNotesPanel({ candidateId, notes }: { candidateId: string; notes: string | null | undefined }) {
  const { t } = useI18n();
  const can = useCan();
  const canEdit = can('candidate', 'update');
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes ?? '');
  const update = trpc.candidate.update.useMutation({
    onSuccess: async () => {
      toast(t.candidates.notesSaved, { type: 'success' });
      setEditing(false);
      await Promise.all([utils.candidate.getById.invalidate({ id: candidateId })]);
    },
    onError: (err) => toast(err.message || t.common.error, { type: 'error' }),
  });
  const value = notes?.trim();
  const tooLong = draft.length > NOTES_MAX;

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.candidates.tabNotes}</h3>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(notes ?? '');
              setEditing(true);
            }}
            className="text-[12px] font-medium text-[#1F114C] hover:underline"
          >
            {t.candidates.notesEdit}
          </button>
        )}
      </div>
      <p className="text-[11px] text-[#8B8B8B] mb-4">{t.candidates.notesHelp}</p>
      {editing ? (
        <div className="space-y-2">
          <label htmlFor="candidate-notes" className="sr-only">
            {t.candidates.tabNotes}
          </label>
          <textarea
            id="candidate-notes"
            rows={6}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={tooLong}
            className="w-full rounded-lg border border-[#EDEDED] p-3 text-[13px] focus:border-[#1F114C] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
          />
          {tooLong && (
            <p role="alert" className="text-[11px] text-red-600">
              {t.candidates.notesTooLong.replace('{max}', String(NOTES_MAX))}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={update.isPending}
              className="h-8 rounded-lg border border-[#EDEDED] px-3 text-[12px] text-[#585858]"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              disabled={tooLong || update.isPending}
              onClick={() => update.mutate({ id: candidateId, notes: draft.trim() })}
              className="h-8 rounded-lg bg-[#1F114C] px-3 text-[12px] font-medium text-white disabled:opacity-50"
            >
              {t.candidates.notesSave}
            </button>
          </div>
        </div>
      ) : value ? (
        <p className="text-[13px] text-[#585858] whitespace-pre-wrap leading-relaxed">{value}</p>
      ) : (
        <p className="text-[12px] text-[#8B8B8B] py-4 text-center">{t.common.noResults}</p>
      )}
    </div>
  );
}
