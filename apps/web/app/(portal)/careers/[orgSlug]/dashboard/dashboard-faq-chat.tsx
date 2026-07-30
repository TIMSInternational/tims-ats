'use client';

import { useState, type FormEvent } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';

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
    <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-[14px] font-semibold text-[#1F114C]">{t.portalDashboard.faqTitle}</h2>
          <p className="text-[12px] text-[#8B8B8B] mt-1">{t.portalDashboard.faqSubtitle}</p>
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="flex flex-wrap gap-2 mb-4">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => submitQuestion(suggestion)}
              disabled={ask.isPending}
              className="rounded-full border border-[#EDEDED] px-3 py-1.5 text-[12px] font-medium text-[#1F114C] hover:bg-[#F6F6F6] disabled:opacity-50"
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
                <p className="text-[11px] font-medium text-[#8B8B8B] mb-1">
                  {mine ? t.portalDashboard.faqYouLabel : t.portalDashboard.faqAssistantLabel}
                </p>
                <div
                  className={
                    mine
                      ? 'inline-block max-w-[85%] rounded-2xl bg-[#1F114C] px-4 py-2 text-left text-[13px] text-white'
                      : 'inline-block max-w-[85%] rounded-2xl bg-[#F6F6F6] px-4 py-2 text-left text-[13px] text-[#333]'
                  }
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
                  {message.sources && message.sources.length > 0 && (
                    <p className="mt-2 text-[11px] text-[#8B8B8B]">
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
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value.slice(0, 800))}
          rows={3}
          maxLength={800}
          placeholder={t.portalDashboard.faqPlaceholder}
          aria-label={t.portalDashboard.faqInputLabel}
          className="w-full resize-none rounded-xl border border-[#EDEDED] px-3 py-2 text-[13px] text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-[#8B8B8B]">{t.portalDashboard.faqPrivacy}</p>
          <button
            type="submit"
            disabled={question.trim().length < 3 || ask.isPending}
            className="h-9 shrink-0 rounded-xl bg-[#1F114C] px-4 text-[12px] font-semibold text-white hover:bg-[#2a1a5e] disabled:opacity-50"
          >
            {ask.isPending ? t.portalDashboard.faqSending : t.portalDashboard.faqSend}
          </button>
        </div>
      </form>
    </section>
  );
}
