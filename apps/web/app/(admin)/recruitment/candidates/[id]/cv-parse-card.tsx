'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { Button, Field, TextArea } from '../../../../../components';
import { CARD, CARD_TITLE } from './card-styles';

/** Extracts structured data from pasted CV text (AI). Lives on Documentos, beside the candidate's files. */
export function CvParseCard({ candidateId }: { candidateId: string }) {
  const { t } = useI18n();
  const ai = t.candidateAi;
  const [text, setText] = useState('');
  const parse = trpc.candidate.parseCV.useMutation({
    onError: () => toast(ai.parseError, { type: 'error' }),
  });
  const data = parse.data;

  const rows: { label: string; value: string | null }[] = data?.parsed
    ? [
        { label: ai.fldName, value: data.name },
        { label: ai.fldEmail, value: data.email },
        { label: ai.fldPhone, value: data.phone },
        { label: ai.fldSkills, value: data.skills.length ? data.skills.join(', ') : null },
        ...(data.summary ? [{ label: ai.fldSummary, value: data.summary }] : []),
      ]
    : [];

  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>{ai.parseTitle}</h2>

      <Field label={ai.parseLabel} help={ai.parseHint} id={`cv-text-${candidateId}`}>
        <TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={ai.parsePlaceholder}
          rows={4}
          maxLength={20000}
          className="resize-y"
        />
      </Field>

      <div className="mt-3 flex justify-end">
        <Button
          variant="secondary"
          onClick={() => parse.mutate({ text, candidateId })}
          disabled={!text.trim()}
          loading={parse.isPending}
          loadingLabel={ai.parsing}
          className="w-full sm:w-auto"
        >
          {ai.parseButton}
        </Button>
      </div>

      {data?.parsed && (
        <div className="mt-3 border-t border-border pt-3">
          <dl className="space-y-1.5 text-body">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-secondary">{ai.confidence}</dt>
              <dd className="font-semibold tabular-nums text-brand">{Math.round(data.confidence * 100)}%</dd>
            </div>
            {rows.map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-secondary">{row.label}</dt>
                <dd className={`min-w-0 break-words text-right ${row.value ? 'text-primary' : 'text-muted'}`}>
                  {row.value ?? ai.noData}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
