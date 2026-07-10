'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import type { VacancyDescriptionVariants, InclusiveLanguageResult } from '../../../../lib/trpc-types';

// ---------------------------------------------------------------------------
// Sprint 1.3 Task 4 — vacancy-creation wizard AI panel.
// Two independent pieces, both extracted out of create-modal.fields.tsx to
// keep that file under the 300-line component limit (CLAUDE.md):
//   1. AiGeneratePanel — one Bedrock call (vacancy.generateDescription) that
//      returns 3 variants (formal/social/whatsapp); each is individually
//      "usable" via a per-tab "Use this" action.
//   2. InclusiveCheckPanel — wires the already-built-but-frontend-unused
//      checkInclusiveLanguage agent onto the current description text.
// ---------------------------------------------------------------------------

type VariantTab = 'formal' | 'social' | 'whatsapp';

interface AiGeneratePanelProps {
  title: string;
  location: string;
  onUseFormal: (
    description: string,
    sections: { responsibilities: string[]; requirements: string[]; benefits: string[] },
  ) => void;
  onUseSocial: (description: string) => void;
  onUseWhatsapp: (description: string) => void;
}

export function AiGeneratePanel({ title, location, onUseFormal, onUseSocial, onUseWhatsapp }: AiGeneratePanelProps) {
  const { t } = useI18n();
  const [variants, setVariants] = useState<VacancyDescriptionVariants | null>(null);
  const [tab, setTab] = useState<VariantTab>('formal');

  const generate = trpc.vacancy.generateDescription.useMutation({
    onSuccess: (data) => {
      setVariants(data);
      setTab('formal');
      toast(t.vacancies.aiVariantsGenerated, { type: 'success' });
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const canGenerate = title.trim().length > 0;
  const activeDescription =
    variants && (tab === 'formal' ? variants.formal.description : tab === 'social' ? variants.social.description : variants.whatsapp.description);

  return (
    <div className="rounded-lg border border-[#EDEDED] bg-[#FAFAFA] p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium text-[#1F114C]">{t.vacancies.aiGenerateTitle}</p>
          <p className="text-[10px] text-[#8B8B8B]">{t.vacancies.aiGenerateDesc}</p>
        </div>
        <button
          type="button"
          onClick={() => generate.mutate({ title, context: location.trim() || undefined })}
          disabled={!canGenerate || generate.isPending}
          className="h-8 px-3 rounded-lg bg-[#1F114C] text-white text-[11px] font-medium hover:bg-[#2a1a5c] transition disabled:opacity-50 flex items-center gap-1.5 shrink-0"
        >
          {generate.isPending && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          {generate.isPending ? t.vacancies.aiGenerating : t.vacancies.aiGenerateAction}
        </button>
      </div>

      {!canGenerate && <p className="text-[10px] text-[#8B8B8B]">{t.vacancies.aiGenerateNeedsTitle}</p>}
      {generate.isError && <p className="text-[11px] text-[#DD0C15]">{generate.error.message}</p>}

      {variants && (
        <div className="space-y-2">
          <div className="flex bg-white rounded-lg overflow-hidden border border-[#EDEDED] h-8">
            {(['formal', 'social', 'whatsapp'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setTab(v)}
                className={`flex-1 text-[11px] font-medium transition ${tab === v ? 'bg-[#1F114C] text-white' : 'text-[#585858]'}`}
              >
                {v === 'formal' ? t.vacancies.aiVariantFormal : v === 'social' ? t.vacancies.aiVariantSocial : t.vacancies.aiVariantWhatsapp}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-lg border border-[#EDEDED] p-2.5 max-h-40 overflow-y-auto">
            <p className="text-[11px] text-[#333] whitespace-pre-wrap">{activeDescription}</p>
          </div>

          <button
            type="button"
            onClick={() => {
              if (tab === 'formal') onUseFormal(variants.formal.description, variants.formal.sections);
              else if (tab === 'social') onUseSocial(variants.social.description);
              else onUseWhatsapp(variants.whatsapp.description);
              toast(t.vacancies.aiVariantApplied, { type: 'success' });
            }}
            className="h-8 px-3 rounded-lg border border-[#1F114C] text-[#1F114C] text-[11px] font-medium hover:bg-[#1F114C]/5 transition"
          >
            {t.vacancies.aiUseVariant}
          </button>
        </div>
      )}
    </div>
  );
}

interface InclusiveCheckPanelProps {
  text: string;
}

export function InclusiveCheckPanel({ text }: InclusiveCheckPanelProps) {
  const { t } = useI18n();
  const [result, setResult] = useState<InclusiveLanguageResult | null>(null);

  const check = trpc.vacancy.checkInclusiveLanguage.useMutation({
    onSuccess: (data) => setResult(data),
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const canCheck = text.trim().length > 0;
  const scoreColor = result ? (result.score >= 80 ? 'text-green-600' : result.score >= 50 ? 'text-amber-600' : 'text-[#DD0C15]') : '';

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => check.mutate({ text })}
        disabled={!canCheck || check.isPending}
        className="h-8 px-3 rounded-lg border border-[#EDEDED] text-[#585858] text-[11px] font-medium hover:bg-[#F6F6F6] transition disabled:opacity-50 flex items-center gap-1.5"
      >
        {check.isPending && <span className="w-3 h-3 border-2 border-[#585858]/30 border-t-[#585858] rounded-full animate-spin" />}
        {check.isPending ? t.vacancies.inclusiveChecking : t.vacancies.inclusiveCheckAction}
      </button>

      {check.isError && <p className="text-[11px] text-[#DD0C15]">{check.error.message}</p>}

      {result && (
        <div className="rounded-lg border border-[#EDEDED] bg-[#FAFAFA] p-2.5 space-y-2">
          <p className="text-[11px] font-medium text-[#333]">
            {t.vacancies.inclusiveScoreLabel}: <span className={scoreColor}>{result.score}/100</span>
          </p>
          {result.suggestions.length > 0 ? (
            <ul className="space-y-1.5">
              {result.suggestions.map((s, i) => (
                <li key={i} className="text-[10px] text-[#585858]">
                  <span className="line-through text-[#8B8B8B]">{s.original}</span> <span className="text-[#333]">{s.suggestion}</span>
                  <p className="text-[10px] text-[#8B8B8B] italic">{s.reason}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[10px] text-[#8B8B8B]">{t.vacancies.inclusiveNoSuggestions}</p>
          )}
        </div>
      )}
    </div>
  );
}
