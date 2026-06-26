// apps/web/app/(portal)/ai-interview/[token]/transcript.ts
export interface TranscriptEntry {
  id: string;
  role: 'ai' | 'user';
  text: string;
  final: boolean;
}

export interface TranscriptState {
  entries: TranscriptEntry[];
}

export interface TranscriptEvent {
  source: 'ai' | 'user';
  text: string;
  final: boolean;
}

export const emptyTranscript: TranscriptState = { entries: [] };

export function applyTranscriptEvent(
  state: TranscriptState,
  event: TranscriptEvent,
): TranscriptState {
  const last = state.entries[state.entries.length - 1];
  const canExtend = last && !last.final && last.role === event.source;

  if (canExtend) {
    const updated: TranscriptEntry = { ...last, text: event.text, final: event.final };
    return { entries: [...state.entries.slice(0, -1), updated] };
  }

  const entry: TranscriptEntry = {
    id: `${state.entries.length}-${event.source}`,
    role: event.source,
    text: event.text,
    final: event.final,
  };
  return { entries: [...state.entries, entry] };
}
