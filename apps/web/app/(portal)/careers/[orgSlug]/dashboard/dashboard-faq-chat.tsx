'use client';

import { useState, type FormEvent } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { Button } from '../../../../../components/button';
import { TextArea } from '../../../../../components/text-area';
import { DASHBOARD_CARD } from './dashboard-styles';

type Source = 'profile' | 'applications' | 'interviews' | 'offers';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  sources?: Source[];
}

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
      <div className="mb-4">
        <h2 id="dashboard-faq-title" className="flex items-center gap-2 text-heading font-semibold text-brand">
          <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
          {t.portalDashboard.faqTitle}
        </h2>
        <p className="mt-1 text-base text-secondary sm:text-body">{t.portalDashboard.faqSubtitle}</p>
      </div>

      {messages.length === 0 ? (
        <div className="flex flex-wrap gap-2 mb-4">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => submitQuestion(suggestion)}
              disabled={ask.isPending}
              className="min-h-7 rounded-full border border-field-border px-3 py-1.5 text-callout font-medium text-brand hover:bg-surface disabled:opacity-50 pointer-coarse:min-h-11"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3 mb-4" aria-live="polite">
          {messages.map((message, index) => {
            const mine = message.role === 'user';
            return (
              <div key={`${message.role}-${index}`} className={mine ? 'text-right' : 'text-left'}>
                <p className="mb-1 text-caption font-medium text-secondary">
                  {mine ? t.portalDashboard.faqYouLabel : t.portalDashboard.faqAssistantLabel}
                </p>
                <div
                  className={
                    mine
                      ? 'inline-block max-w-[85%] rounded-2xl bg-brand px-4 py-2 text-left text-base text-white sm:text-body'
                      : 'inline-block max-w-[85%] rounded-2xl bg-surface px-4 py-2 text-left text-base text-primary sm:text-body'
                  }
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
                  {message.sources && message.sources.length > 0 && (
                    <p className={`mt-2 text-caption ${mine ? 'text-white/80' : 'text-secondary'}`}>
                      {t.portalDashboard.faqSources}: {message.sources.map((s) => sourceLabel(s, t)).join(', ')}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <TextArea
          value={question}
          onChange={(event) => setQuestion(event.target.value.slice(0, 800))}
          rows={3}
          maxLength={800}
          placeholder={t.portalDashboard.faqPlaceholder}
          aria-label={t.portalDashboard.faqInputLabel}
          className="resize-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-callout text-secondary">{t.portalDashboard.faqPrivacy}</p>
          <Button
            type="submit"
            disabled={question.trim().length < 3}
            loading={ask.isPending}
            loadingLabel={t.portalDashboard.faqSending}
            className="shrink-0"
          >
            {t.portalDashboard.faqSend}
          </Button>
        </div>
      </form>
    </section>
  );
}
