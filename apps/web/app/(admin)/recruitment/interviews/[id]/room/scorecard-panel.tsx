'use client';

import { useState } from 'react';
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
}

export function ScorecardPanel({ interview, candidateInitials }: ScorecardPanelProps) {
  const { t } = useI18n();
  const { userId } = usePermissions();
  const [activeTab, setActiveTab] = useState<Tab>('scorecard');

  const tabLabel: Record<Tab, string> = {
    scorecard: t.interviewRoom.tabScorecard,
    ai: t.interviews.aiTab,
    candidate: t.interviewRoom.tabCandidate,
  };

  return (
    <div className="flex-1 md:flex-[40] flex flex-col bg-white border-t md:border-t-0 md:border-l border-[#EDEDED] min-h-0">
      <div role="tablist" aria-label={t.interviewRoom.tabsLabel} className="flex border-b border-[#EDEDED] shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`room-tab-${tab}`}
            aria-selected={activeTab === tab}
            aria-controls={`room-panel-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 text-[12px] font-medium text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1F114C] ${
              activeTab === tab ? 'text-[#1F114C] border-b-2 border-[#DD0C15]' : 'text-[#8B8B8B] hover:text-[#585858]'
            }`}
          >
            {tabLabel[tab]}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`room-panel-${activeTab}`}
        aria-labelledby={`room-tab-${activeTab}`}
        className="flex-1 min-h-0 flex flex-col"
      >
        {activeTab === 'scorecard' && <ScorecardForm interview={interview} currentUserId={userId} />}
        {activeTab === 'ai' && (
          <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
            <InterviewAiPanel interviewId={interview.id} />
          </div>
        )}
        {activeTab === 'candidate' && (
          <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
            <CandidateTab interview={interview} candidateInitials={candidateInitials} />
          </div>
        )}
      </div>
    </div>
  );
}
