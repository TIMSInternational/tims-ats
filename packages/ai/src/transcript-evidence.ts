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

/** The longest verified quote returned (the analysis result's own bound on a quote). */
export const MAX_QUOTE_CHARS = 200;

/**
 * A token is a run of anything but whitespace, sentence punctuation and quote marks — except that a '.' or ',' BETWEEN
 * two digits belongs to the number ("3.5%", "1,200,000"): splitting there would let "5%" verify against "3.5%".
 * Signs, symbols and hyphens stay inside their token, so "-20%" and "20%" are different tokens.
 */
const TOKEN = /(?:[^\s.,;:!?¡¿…"'“”‘’«»()[\]{}]|(?<=\p{N})[.,](?=\p{N}))+/gu;

interface Token {
  /** Lowercased, for comparison. */
  text: string;
  /** Offsets into the NFC text the token was read from (so the source can be quoted exactly). */
  start: number;
  end: number;
}

function tokenize(nfcText: string): Token[] {
  return [...nfcText.matchAll(TOKEN)].map((m) => ({
    text: m[0].toLowerCase(),
    start: m.index,
    end: m.index + m[0].length,
  }));
}

/**
 * Lowercase, NFC, whitespace collapsed, and ONLY sentence punctuation and quote marks ignored — so a quote matches
 * despite commas, line breaks or « » vs " ". Signs, symbols and digits are kept: "+20%" must never verify against a
 * candidate who said "-20%" (Codex P1). Hyphens/dashes stay too, for the same reason; so do decimal and thousands
 * separators inside a number.
 */
export function normalizeForMatch(text: string): string {
  return tokenize(text.normalize('NFC'))
    .map((t) => t.text)
    .join(' ');
}

const LONE_SIGN = /^[+\-−±]$/u;
const STARTS_NUMERIC = /^[\p{N}%‰]/u;
const ENDS_NUMERIC = /\p{N}$/u;

/**
 * True when tokens `from..to` of `source` do not cut a number written with spaces: a match that starts with a digit
 * must not follow a lone sign ("- 20%") or a digit group ("1 200 000"), and one that ends with a digit must not be
 * followed by another digit group or a percent sign ("20 %"). Only a whitespace gap joins them; punctuation separates.
 */
function keepsNumbersWhole(source: string, tokens: readonly Token[], from: number, to: number): boolean {
  const first = tokens[from]!;
  const before = tokens[from - 1];
  if (
    before &&
    /^\s*$/u.test(source.slice(before.end, first.start)) &&
    /^\p{N}/u.test(first.text) &&
    (ENDS_NUMERIC.test(before.text) || LONE_SIGN.test(before.text))
  )
    return false;
  const last = tokens[to]!;
  const after = tokens[to + 1];
  return !(
    after &&
    /^\s*$/u.test(source.slice(last.end, after.start)) &&
    ENDS_NUMERIC.test(last.text) &&
    STARTS_NUMERIC.test(after.text)
  );
}

/** A verified quote: the candidate segment it is in, and the transcript's OWN text for it (never the model's). */
export interface LocatedQuote {
  segment: TranscriptSegment;
  text: string;
}

/**
 * The CANDIDATE segment that contains `quote` as a run of WHOLE tokens (after normalization), with the exact source
 * text of that run — or null. Substring matching is not enough: "20% revenue growth" is inside "120% revenue growth"
 * and "20% year over year" inside "-20% year over year" (Codex P1). Evidence about a candidate's competency must be
 * the candidate's own words; anything the model cannot point to is dropped, and what is kept is quoted from the
 * transcript, so the model's punctuation or casing never reaches a reviewer.
 */
export function locateCandidateQuote(quote: string, segments: readonly TranscriptSegment[]): LocatedQuote | null {
  const needle = tokenize(quote.normalize('NFC'));
  if (needle.map((t) => t.text).join(' ').length < MIN_QUOTE_CHARS) return null;
  for (const segment of segments) {
    if (segment.speaker !== CANDIDATE_SPEAKER) continue;
    const source = segment.text.normalize('NFC');
    const tokens = tokenize(source);
    for (let i = 0; i + needle.length <= tokens.length; i++) {
      if (!needle.every((t, k) => tokens[i + k]!.text === t.text)) continue;
      const to = i + needle.length - 1;
      if (!keepsNumbersWhole(source, tokens, i, to)) continue;
      const text = source.slice(tokens[i]!.start, tokens[to]!.end);
      if (text.length <= MAX_QUOTE_CHARS) return { segment, text };
    }
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

// Statements about protected characteristics, or about emotions/personality/demeanour inferred from how someone
// speaks, are out of scope for an employment evaluation (EU AI Act Art. 5(1)(f) bans emotion recognition at work;
// Ley 8968 treats several of these as sensitive data). The PROMPT is the primary control (PROTECTED_ATTRIBUTES_RULE +
// the analyst's own rules) and a human reviews every suggestion; this is only a LEXICAL BACKSTOP on the model's
// output for common phrasings in es/en. It is NOT a guarantee: a paraphrase it does not list passes. Stems describe
// the PERSON, not a topic, so "experiencia en el sector salud" passes while "parecía nervioso" does not.
// Whole words only (Unicode-aware boundaries): "raza" must not match "abrazar", nor "shy" "pushy".
const STEMS = [
  // emotions / anxiety
  'nervios[oa]s?',
  'ansios[oa]s?',
  'ansiedad',
  'emocional(?:es|mente)?',
  'emoci[oó]n(?:es)?',
  'nervous(?:ness)?',
  'anxious',
  'anxiety',
  'emotional(?:ly)?',
  'emotions?',
  'stressed',
  'estresad[oa]',
  // personality / demeanour
  'personalidad',
  'personality',
  'temperament[oa]?',
  'introvertid[oa]',
  'extrovertid[oa]',
  'introvert(?:ed)?',
  'extrovert(?:ed)?',
  'inseguridad',
  'insegur[oa]',
  'insecure',
  'timidez',
  't[ií]mid[oa]',
  'shy(?:ness)?',
  // Not bare 'confidence' or 'race': "confidence intervals" and "race conditions" are job content.
  'confident(?:ly)?',
  'self-confidence',
  'self-assured',
  'segur[oa] de s[ií]',
  '(?:confianza|seguridad) en s[ií] mism[oa]',
  'outgoing',
  'sociable',
  'charismatic',
  'charisma',
  'carism[aá]tic[oa]',
  'carisma',
  'enthusiastic',
  'enthusiasm',
  'entusiasta',
  'entusiasmo',
  'energetic',
  'en[eé]rgic[oa]',
  'passionate',
  'apasionad[oa]',
  'calm',
  'calmad[oa]',
  'tranquil[oa]',
  'friendly',
  'simp[aá]tic[oa]',
  'likeable',
  'personable',
  'humble',
  'humilde',
  'arrogant',
  'arrogante',
  'tone of voice',
  'tono de voz',
  // age
  'edad',
  'age',
  'aged',
  'too (?:old|young)',
  '(?:demasiado|muy) (?:joven|mayor|viej[oa])',
  'years old',
  // other protected characteristics
  'embaraz[\\p{L}]*',
  'pregnan[\\p{L}]*',
  'religi[oó]n',
  'religios[oa]',
  'religio(?:n|us)',
  '[eé]tnic[oa]',
  'ethnic(?:ity)?',
  'raza',
  'acento',
  'accent',
  'discapacidad',
  'disabilit(?:y|ies)',
  'disabled',
  'orientaci[oó]n sexual',
  'sexual orientation',
  'estado civil',
  'marital status',
];
const PROTECTED_INFERENCE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${STEMS.join('|')})(?![\\p{L}\\p{N}])`, 'iu');

export function mentionsProtectedInference(text: string): boolean {
  return PROTECTED_INFERENCE.test(text.normalize('NFC'));
}

/** Drops each sentence of `text` that mentions a protected inference; reports whether anything was dropped. */
export function stripProtectedSentences(text: string): { text: string; stripped: boolean } {
  const sentences = text.split(/(?<=[.!?¿¡])\s+/u);
  const kept = sentences.filter((s) => !mentionsProtectedInference(s));
  return { text: kept.join(' ').trim(), stripped: kept.length !== sentences.length };
}
