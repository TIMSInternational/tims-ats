'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../../../lib/i18n';
import { usePermissions } from '../../../../../../lib/permissions';
import type { InterviewDetail } from '../../../../../../lib/trpc-types';
import { InterviewAiPanel } from './interview-ai-panel';
import { ScorecardForm } from './scorecard-form';
import { CandidateTab } from './candidate-tab';

// The old "Notas" tab kept text in component state only (lost on reload) and
// was removed: evidence now goes in the scorecard's persisted notes field.
const TABS = ['scorecard', 'ai', 'candidate'] as const;
type Tab = (typeof TABS)[number];

interface ScorecardPanelProps {
  interview: InterviewDetail;
  candidateInitials: string;
  /** Bumped by the room on every mode switch: moves focus to this panel's heading. */
  focusRequest?: number;
}

export function ScorecardPanel({ interview, candidateInitials, focusRequest = 0 }: ScorecardPanelProps) {
  const { t } = useI18n();
  const { userId } = usePermissions();
  const [activeTab, setActiveTab] = useState<Tab>('scorecard');
  // A tab's panel mounts the first time it opens and then stays mounted (hidden), so a generated AI
  // guide or summary survives switching to the scorecard and back.
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(() => new Set(['scorecard'] as Tab[]));
  const openTab = (tab: Tab) => {
    setActiveTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set([...prev, tab])));
  };
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusRequest === 0) return;
    // Focus only: the evaluator may be reading another tab; do not switch it.
    headingRef.current?.focus();
  }, [focusRequest]);
  // Mirrors the server's blind-evaluation rule for UI affordances only (the server enforces it).
  const isViewerBlinded =
    userId !== null &&
    interview.evaluators.some((e) => e.userId === userId) &&
    !interview.scorecards.some((s) => s.evaluatorId === userId && s.submittedAt !== null);

  const tabLabel: Record<Tab, string> = {
    scorecard: t.interviewRoom.tabScorecard,
    ai: t.interviews.aiTab,
    candidate: t.interviewRoom.tabCandidate,
  };

  return (
    <div className="flex-1 md:flex-[40] flex flex-col bg-white border-t md:border-t-0 md:border-l border-border min-h-0">
      <h2 ref={headingRef} tabIndex={-1} className="sr-only">
        {t.interviewRoom.panelHeading}
      </h2>
      <div role="tablist" aria-label={t.interviewRoom.tabsLabel} className="flex border-b border-border shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`room-tab-${tab}`}
            aria-selected={activeTab === tab}
            aria-controls={`room-panel-${tab}`}
            onClick={() => openTab(tab)}
            className={`-mb-px flex-1 border-b-2 py-3 text-center text-body transition-colors pointer-coarse:min-h-11 ${
              activeTab === tab ? 'border-brand font-semibold text-brand' : 'border-transparent text-secondary hover:text-brand'
            }`}
          >
            {tabLabel[tab]}
          </button>
        ))}
      </div>

      {/* The scorecard form owns the unsaved draft (ratings, recommendation, notes), so it
          stays mounted and is only hidden while another tab is open — unmounting it would
          silently discard the evaluator's in-progress edits on every tab switch. */}
      <div
        role="tabpanel"
        id="room-panel-scorecard"
        aria-labelledby="room-tab-scorecard"
        hidden={activeTab !== 'scorecard'}
        className={`flex-1 min-h-0 flex-col ${activeTab === 'scorecard' ? 'flex' : 'hidden'}`}
      >
        <ScorecardForm interview={interview} currentUserId={userId} />
      </div>
      {(['ai', 'candidate'] as const).map((tab) =>
        visited.has(tab) ? (
          <div
            key={tab}
            role="tabpanel"
            id={`room-panel-${tab}`}
            aria-labelledby={`room-tab-${tab}`}
            hidden={activeTab !== tab}
            className={`flex-1 min-h-0 flex-col ${activeTab === tab ? 'flex' : 'hidden'}`}
          >
            <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
              {tab === 'ai' ? (
                <InterviewAiPanel interviewId={interview.id} isViewerBlinded={isViewerBlinded} />
              ) : (
                <CandidateTab interview={interview} candidateInitials={candidateInitials} />
              )}
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}
