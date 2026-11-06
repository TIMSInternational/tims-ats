// ---------------------------------------------------------------------------
// Pure helpers of the interview-transcript analyst (agents/interview-transcript-analyst.ts) (no I/O, no model calls):
// chunking a pseudonymized transcript, verifying every quote the model returns
// against the transcript itself, and a lexical guard that drops statements about
// protected or psychological characteristics. Kept separate so each rule is
// unit-testable and mutation-checkable on its own.
// ---------------------------------------------------------------------------

export interface TranscriptSegment {
  startSeconds: number;
  /** A ROLE, never a name: candidate | interviewer_N | participant_N | unknown. */
  speaker: string;
  text: string;
}

export const CANDIDATE_SPEAKER = 'candidate';
/** Transcript characters per model call — keeps every built prompt well under invoke's 32k cap. */
export const CHUNK_CHAR_BUDGET = 22_000;
export const MAX_CHUNKS = 4;
/** A quote shorter than this (after normalization) proves nothing and is dropped. */
export const MIN_QUOTE_CHARS = 12;

export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hh > 0 ? `${hh}:${two(mm)}:${two(ss)}` : `${two(mm)}:${two(ss)}`;
}

/** One line per segment: `[mm:ss] speaker: text` — the exact form the model sees and cites. */
export function renderSegment(segment: TranscriptSegment): string {
  return `[${formatTimestamp(segment.startSeconds)}] ${segment.speaker}: ${segment.text}`;
}

/**
 * Splits the transcript into at most MAX_CHUNKS consecutive chunks of at most CHUNK_CHAR_BUDGET rendered
 * characters. A single segment longer than the budget is cut (the C# side already bounds segments to 1,200).
 */
export function chunkTranscript(segments: readonly TranscriptSegment[]): {
  chunks: TranscriptSegment[][];
  truncated: boolean;
} {
  const chunks: TranscriptSegment[][] = [];
  let current: TranscriptSegment[] = [];
  let size = 0;
  for (const segment of segments) {
    const length = renderSegment(segment).length + 1;
    if (current.length > 0 && size + length > CHUNK_CHAR_BUDGET) {
      chunks.push(current);
      if (chunks.length === MAX_CHUNKS) return { chunks, truncated: true };
      current = [];
      size = 0;
    }
    current.push(
      length > CHUNK_CHAR_BUDGET ? { ...segment, text: segment.text.slice(0, CHUNK_CHAR_BUDGET - 64) } : segment,
    );
    size += Math.min(length, CHUNK_CHAR_BUDGET);
  }
  if (current.length > 0) chunks.push(current);
  return { chunks, truncated: false };
}

/** Lowercase, NFC, punctuation and whitespace collapsed — so a quote matches despite commas or line breaks. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

/**
 * The CANDIDATE segment that contains `quote` verbatim (after normalization), or null. Evidence about a
 * candidate's competency must be the candidate's own words; anything the model cannot point to is dropped.
 */
export function locateCandidateQuote(quote: string, segments: readonly TranscriptSegment[]): TranscriptSegment | null {
  const needle = normalizeForMatch(quote);
  if (needle.length < MIN_QUOTE_CHARS) return null;
  for (const segment of segments) {
    if (segment.speaker !== CANDIDATE_SPEAKER) continue;
    if (normalizeForMatch(segment.text).includes(needle)) return segment;
  }
  return null;
}

/** The latest segment starting at or before `seconds` (snap a model-cited time to a real one), else the first. */
export function snapToSegment(seconds: number, segments: readonly TranscriptSegment[]): number {
  let best = segments[0]?.startSeconds ?? 0;
  for (const segment of segments) {
    if (segment.startSeconds <= seconds) best = segment.startSeconds;
    else break;
  }
  return best;
}

// Statements about protected characteristics or about emotions/personality inferred from how someone
// speaks are out of scope for an employment evaluation (EU AI Act Art. 5(1)(f) bans emotion recognition at
// work; Ley 8968 treats several of these as sensitive data). The prompt forbids them; this is the
// belt-and-braces check on the model's OUTPUT. Deliberately narrow (stems that describe the person, not
// topics), so "experiencia en el sector salud" passes while "parecía nervioso" does not.
// Whole words only (Unicode-aware boundaries): "raza" must not match "abrazar", nor "shy" "pushy".
const PROTECTED_INFERENCE = new RegExp(
  '(?<![\\p{L}\\p{N}])(?:' +
  [
    'nervios[oa]s?',
    'ansios[oa]s?',
    'ansiedad',
    'emocional(?:es|mente)?',
    'emoci[oó]n(?:es)?',
    'personalidad',
    'introvertid[oa]',
    'extrovertid[oa]',
    'inseguridad',
    'insegur[oa]',
    'timidez',
    't[ií]mid[oa]',
    'su edad',
    'embaraz[\\p{L}]*',
    'religi[oó]n',
    'religios[oa]',
    '[eé]tnic[oa]',
    'raza',
    'acento',
    'discapacidad',
    'orientaci[oó]n sexual',
    'estado civil',
    'nervous',
    'anxious',
    'anxiety',
    'emotional(?:ly)?',
    'emotions?',
    'personality',
    'introvert(?:ed)?',
    'extrovert(?:ed)?',
    'insecure',
    'shy',
    'pregnan[\\p{L}]*',
    'religio(?:n|us)',
    'ethnic(?:ity)?',
    'accent',
    'disabilit(?:y|ies)',
    'sexual orientation',
    'marital status',
  ].join('|') +
  ')(?![\\p{L}\\p{N}])',
  'iu',
);

export function mentionsProtectedInference(text: string): boolean {
  return PROTECTED_INFERENCE.test(text.normalize('NFC'));
}

/** Drops each sentence of `text` that mentions a protected inference; reports whether anything was dropped. */
export function stripProtectedSentences(text: string): { text: string; stripped: boolean } {
  const sentences = text.split(/(?<=[.!?¿¡])\s+/u);
  const kept = sentences.filter((s) => !mentionsProtectedInference(s));
  return { text: kept.join(' ').trim(), stripped: kept.length !== sentences.length };
}
