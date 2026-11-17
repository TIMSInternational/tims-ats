'use client';

import { useState, type FormEvent } from 'react';
import { ShieldCheck, Sparkles } from 'lucide-react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { EvalButton } from './eval-button';
import { EvalField } from './eval-field';
import { EVAL_TEXTAREA_CLASSES } from './eval-control-styles';
import { EVAL_BODY_CLASSES, EVAL_CAPTION_CLASSES, EVAL_FACT_LABEL_CLASSES } from './eval-styles';
import { DASHBOARD_CARD, DASHBOARD_HEADING, DASHBOARD_LEAD } from './dashboard-styles';

type Source = 'profile' | 'applications' | 'interviews' | 'offers';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  sources?: Source[];
}

// The section in the TIMS evaluation design (PCA): a serif h2 with the Sparkles mark, the r-lead line that says the
// answers are generated, suggestion chips, the PCA free-text field and a primary "Ask".
const FAQ_TITLE_CLASSES = `${DASHBOARD_HEADING} flex items-center gap-2`;
const FAQ_TITLE_ICON_CLASSES = 'size-[18px] shrink-0 text-eval-accent';
/** Suggestions: PCA neutral chips (bg2, tile hairline) as buttons, a 44px target. */
const FAQ_SUGGESTIONS_CLASSES = 'mb-4 flex flex-wrap gap-2';
const FAQ_SUGGESTION_CLASSES =
  'inline-flex min-h-11 items-center rounded-full border border-eval-tile-line bg-eval-bg2 px-3.5 py-2 text-left text-eval-sm leading-[1.35] font-semibold text-eval-ink transition-colors motion-reduce:transition-none hover:bg-eval-bg3 disabled:cursor-not-allowed disabled:text-eval-ink2 disabled:hover:bg-eval-bg2';
/** The conversation: the question on the right in the PCA secondary shape (white, line border), the answer in a bg2
 * soft panel on the left. */
const FAQ_THREAD_CLASSES = 'mb-4 flex flex-col gap-3';
const FAQ_ROW_MINE_CLASSES = 'flex flex-col items-end gap-1';
const FAQ_ROW_ASSISTANT_CLASSES = 'flex flex-col items-start gap-1';
const FAQ_BUBBLE_MINE_CLASSES = `max-w-[85%] rounded-eval-card border border-eval-line bg-white px-4 py-3 ${EVAL_BODY_CLASSES}`;
const FAQ_BUBBLE_ASSISTANT_CLASSES = `w-full rounded-eval-card bg-eval-bg2 px-4 py-3 md:max-w-[85%] ${EVAL_BODY_CLASSES}`;
const FAQ_MESSAGE_TEXT_CLASSES = 'm-0 whitespace-pre-wrap break-words';
const FAQ_SOURCES_CLASSES = `${EVAL_CAPTION_CLASSES} mt-2`;
const FAQ_FORM_CLASSES = 'flex flex-col gap-3';
/** The note and "Ask": stacked on phones (the note first), one row from md. */
const FAQ_FOOT_CLASSES = 'flex flex-col gap-3 md:flex-row md:items-center md:justify-between';
/** The PCA's quiet line with an icon (the landing's "saves itself" line): the privacy note. */
const FAQ_NOTE_CLASSES = 'm-0 flex items-start gap-1.5 text-eval-sm leading-[1.45] text-eval-ink2';
const FAQ_NOTE_ICON_CLASSES = 'mt-px size-4 shrink-0';

function sourceLabel(source: Source, t: ReturnType<typeof useI18n>['t']) {
  switch (source) {
    case 'profile':
      return t.portalDashboard.faqSourceProfile;
    case 'applications':
      return t.portalDashboard.faqSourceApplications;
    case 'interviews':
      return t.portalDashboard.faqSourceInterviews;
    case 'offers':
      return t.portalDashboard.faqSourceOffers;
  }
}

// Candidate FAQ assistant. The browser sends only an org slug and free-text
// question; the API derives the candidate and allowed context from the Supabase
// session server-side before calling the gated AI agent.
export function DashboardFaqChat({ orgSlug }: { orgSlug: string }) {
  const { t } = useI18n();
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const ask = trpc.candidatePortal.askFaq.useMutation();

  const suggestions = [
    t.portalDashboard.faqSuggestionStatus,
    t.portalDashboard.faqSuggestionInterview,
    t.portalDashboard.faqSuggestionOffer,
  ];

  const submitQuestion = (rawQuestion: string) => {
    const trimmed = rawQuestion.trim();
    if (trimmed.length < 3 || ask.isPending) return;

    setMessages((current) => [...current, { role: 'user', text: trimmed }]);
    setQuestion('');
    ask.mutate(
      { orgSlug, question: trimmed },
      {
        onSuccess: (data) => {
          setMessages((current) => [...current, { role: 'assistant', text: data.answer, sources: data.sources }]);
        },
        onError: () => {
          setMessages((current) => [...current, { role: 'assistant', text: t.portalDashboard.faqError }]);
        },
      },
    );
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitQuestion(question);
  };

  return (
    <section aria-labelledby="dashboard-faq-title" className={DASHBOARD_CARD}>
      {/* The answers are generated: the title, the subtitle and every reply label say so (generative-ai.md). */}
      <h2 id="dashboard-faq-title" className={FAQ_TITLE_CLASSES}>
        <Sparkles aria-hidden="true" focusable="false" className={FAQ_TITLE_ICON_CLASSES} />
        {t.portalDashboard.faqTitle}
      </h2>
      <p className={DASHBOARD_LEAD}>{t.portalDashboard.faqSubtitle}</p>

      {messages.length === 0 ? (
        <div className={FAQ_SUGGESTIONS_CLASSES}>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => submitQuestion(suggestion)}
              disabled={ask.isPending}
              className={FAQ_SUGGESTION_CLASSES}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : (
        <div className={FAQ_THREAD_CLASSES} aria-live="polite">
          {messages.map((message, index) => {
            const mine = message.role === 'user';
            return (
              <div key={`${message.role}-${index}`} className={mine ? FAQ_ROW_MINE_CLASSES : FAQ_ROW_ASSISTANT_CLASSES}>
                <p className={EVAL_FACT_LABEL_CLASSES}>
                  {mine ? t.portalDashboard.faqYouLabel : t.portalDashboard.faqAssistantLabel}
                </p>
                <div className={mine ? FAQ_BUBBLE_MINE_CLASSES : FAQ_BUBBLE_ASSISTANT_CLASSES}>
                  <p className={FAQ_MESSAGE_TEXT_CLASSES}>{message.text}</p>
                  {message.sources && message.sources.length > 0 && (
                    <p className={FAQ_SOURCES_CLASSES}>
                      {t.portalDashboard.faqSources}: {message.sources.map((s) => sourceLabel(s, t)).join(', ')}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={onSubmit} className={FAQ_FORM_CLASSES}>
        <EvalField label={t.portalDashboard.faqInputLabel} hideLabel>
          {(control) => (
            <textarea
              {...control}
              value={question}
              onChange={(event) => setQuestion(event.target.value.slice(0, 800))}
              rows={3}
              maxLength={800}
              placeholder={t.portalDashboard.faqPlaceholder}
              className={EVAL_TEXTAREA_CLASSES}
            />
          )}
        </EvalField>
        <div className={FAQ_FOOT_CLASSES}>
          <p className={FAQ_NOTE_CLASSES}>
            <ShieldCheck aria-hidden="true" focusable="false" className={FAQ_NOTE_ICON_CLASSES} />
            <span>{t.portalDashboard.faqPrivacy}</span>
          </p>
          <EvalButton
            type="submit"
            size="compact"
            width="bar"
            disabled={question.trim().length < 3}
            loading={ask.isPending}
            loadingLabel={t.portalDashboard.faqSending}
            className="shrink-0"
          >
            {t.portalDashboard.faqSend}
          </EvalButton>
        </div>
      </form>
    </section>
  );
}
