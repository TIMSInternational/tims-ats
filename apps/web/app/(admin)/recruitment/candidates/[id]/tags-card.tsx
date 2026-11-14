'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { useI18n } from '../../../../../lib/i18n';
import { Button, FIELD_ERROR_CLASSES, IconButton, StatusBadge, inputClasses } from '../../../../../components';
import { CARD, CARD_TITLE } from './card-styles';

interface Tag {
  id: string;
  tag: string;
  source: string;
}

export function TagsCard({ tags, candidateId }: { tags: Tag[]; candidateId: string }) {
  const { t } = useI18n();
  const [newTag, setNewTag] = useState('');
  const utils = trpc.useUtils();
  const inputId = `new-tag-${candidateId}`;
  const errorId = `${inputId}-error`;

  const addTag = trpc.candidate.addTag.useMutation({
    onSuccess: () => {
      utils.candidate.getById.invalidate({ id: candidateId });
      setNewTag('');
    },
    // A rejected tag (duplicate, too long) is shown under the field it concerns, not in a toast.
  });

  const removeTag = trpc.candidate.removeTag.useMutation({
    onSuccess: () => {
      utils.candidate.getById.invalidate({ id: candidateId });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const handleAdd = () => {
    if (!newTag.trim()) return;
    addTag.mutate({ candidateId, tag: newTag.trim() });
  };
  const addError = addTag.error ? t.candidates.tagAddError : null;

  return (
    <section className={CARD}>
      <h2 className={`${CARD_TITLE} mb-3`}>{t.candidates.tags}</h2>
      {tags.length === 0 ? (
        <p className="mb-3 text-body text-secondary">{t.candidates.noTags}</p>
      ) : (
        <ul className="mb-3 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag.id}>
              <StatusBadge tone={tag.source === 'ai' ? 'brand' : 'neutral'} icon="none" className="py-0 pr-0.5">
                {tag.source === 'ai' && <span>{t.candidates.aiTagPrefix}: </span>}
                {tag.tag}
                <IconButton
                  label={`${t.common.removeTag}: ${tag.tag}`}
                  size="sm"
                  hideTooltip
                  onClick={() => removeTag.mutate({ candidateId, tag: tag.tag })}
                  disabled={removeTag.isPending}
                  className="-my-1 rounded-full text-current hover:bg-black/5"
                >
                  <svg
                    className="size-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </IconButton>
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={inputId} className="sr-only">
            {t.candidates.newTagLabel}
          </label>
          <input
            id={inputId}
            type="text"
            value={newTag}
            onChange={(e) => {
              setNewTag(e.target.value);
              if (addTag.error) addTag.reset();
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder={t.candidates.addTag}
            maxLength={50}
            aria-invalid={addError ? true : undefined}
            aria-describedby={addError ? errorId : undefined}
            className={inputClasses('md')}
          />
          {addError && (
            <p id={errorId} role="alert" className={FIELD_ERROR_CLASSES}>
              {addError}
            </p>
          )}
        </div>
        <Button variant="secondary" onClick={handleAdd} disabled={!newTag.trim()} loading={addTag.isPending}>
          {t.candidates.addTagButton}
        </Button>
      </div>
    </section>
  );
}
