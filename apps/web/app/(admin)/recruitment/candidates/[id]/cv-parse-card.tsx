'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';

export function CvParseCard() {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const parse = trpc.candidate.parseCV.useMutation({
    onError: () => toast(t.candidateAi.parseError, { type: 'error' }),
  });
  const data = parse.data;

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.candidateAi.parseTitle}</h3>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t.candidateAi.parsePlaceholder}
        rows={4}
        maxLength={20000}
        className="w-full border border-[#EDEDED] rounded-lg p-2.5 text-[12px] outline-none focus:border-[#1F114C] resize-none"
      />

      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-[#8B8B8B]">{t.candidateAi.parseHint}</span>
        <button
          onClick={() => parse.mutate({ text })}
          disabled={!text.trim() || parse.isPending}
          className="bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium disabled:opacity-50"
        >
          {parse.isPending ? t.candidateAi.parsing : t.candidateAi.parseButton}
        </button>
      </div>

      {data?.parsed && (
        <div className="mt-3 pt-3 border-t border-[#EDEDED] space-y-1.5 text-[12px]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#8B8B8B]">{t.candidateAi.confidence}</span>
            <span className="text-[10px] font-semibold text-[#1F114C]">{Math.round(data.confidence * 100)}%</span>
          </div>
          <Field label={t.candidateAi.fldName} value={data.name} fallback={t.candidateAi.noData} />
          <Field label={t.candidateAi.fldEmail} value={data.email} fallback={t.candidateAi.noData} />
          <Field label={t.candidateAi.fldPhone} value={data.phone} fallback={t.candidateAi.noData} />
          <Field label={t.candidateAi.fldSkills} value={data.skills.length ? data.skills.join(', ') : null} fallback={t.candidateAi.noData} />
          {data.summary && <Field label={t.candidateAi.fldSummary} value={data.summary} fallback={t.candidateAi.noData} />}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, fallback }: { label: string; value: string | null; fallback: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[#8B8B8B] shrink-0">{label}</span>
      <span className={`text-right ${value ? 'text-[#333]' : 'text-[#bbb]'}`}>{value ?? fallback}</span>
    </div>
  );
}
