'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { useI18n } from '../../../../../lib/i18n';
import { useCan } from '../../../../../lib/permissions';
import { Button, EmptyState, FIELD_ERROR_CLASSES, textareaClasses } from '../../../../../components';
import { CARD, CARD_TITLE } from './card-styles';

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
  const startEditing = () => {
    setDraft(notes ?? '');
    setEditing(true);
  };

  return (
    <section className={CARD}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className={`${CARD_TITLE} mb-0`}>{t.candidates.tabNotes}</h2>
        {canEdit && !editing && value && (
          <Button variant="secondary" size="sm" onClick={startEditing}>
            {t.candidates.notesEdit}
          </Button>
        )}
      </div>
      <p className="mb-4 max-w-prose text-callout text-secondary">{t.candidates.notesHelp}</p>
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
            aria-invalid={tooLong || undefined}
            aria-describedby={tooLong ? 'candidate-notes-error' : undefined}
            autoFocus
            className={textareaClasses()}
          />
          {tooLong && (
            <p id="candidate-notes-error" role="alert" className={FIELD_ERROR_CLASSES}>
              {t.candidates.notesTooLong.replace('{max}', String(NOTES_MAX))}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={update.isPending}>
              {t.common.cancel}
            </Button>
            <Button
              size="sm"
              disabled={tooLong}
              loading={update.isPending}
              onClick={() => update.mutate({ id: candidateId, notes: draft.trim() })}
            >
              {t.candidates.notesSave}
            </Button>
          </div>
        </div>
      ) : value ? (
        <p className="max-w-prose whitespace-pre-wrap text-body leading-relaxed text-primary">{value}</p>
      ) : (
        <EmptyState
          size="compact"
          title={t.candidates.notesEmpty}
          action={canEdit ? { label: t.candidates.notesAdd, onClick: startEditing, variant: 'secondary' } : undefined}
        />
      )}
    </section>
  );
}
