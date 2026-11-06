// ---------------------------------------------------------------------------
// PII + prompt-safety layer for AI calls.
//
// Two complementary defenses, both consumed by the gated invokeAgent (PR 3):
//
//  1. Input sanitization (this file, always on): user-supplied text (CVs, job
//     descriptions) is DATA, never instructions. We strip control / zero-width /
//     bidi characters used to smuggle hidden directives, defang the most common
//     prompt-injection markers, and wrap content so it cannot break out of its
//     XML delimiter. Aligns with CLAUDE.md §6 Guardrails.
//
//  2. Bedrock Guardrails MASK (env-gated, defense-in-depth): when a guardrail is
//     provisioned (BEDROCK_GUARDRAIL_ID), every Bedrock call references it so AWS
//     masks PII server-side. The MASK policy itself lives in the AWS guardrail
//     config; here we only attach the reference. CLAUDE.md §7.
//
// Full PII tokenization (Presidio strip/re-inject) is deferred to a measured
// scale-trigger per coding rule #9 — this is the pragmatic first layer.
// ---------------------------------------------------------------------------

const DEFAULT_MAX_LENGTH = 8000;

// Control chars (C0 except \t \n \r, plus DEL and C1), zero-width, and bidi
// override/isolate characters — all stripped. Bidi/zero-width are a known
// channel for hiding instructions that render invisibly but still reach the
// model. Written as code-point escapes (no literal invisible chars in source):
//   \x00-\x08\x0B\x0C\x0E-\x1F  C0 controls except tab/newline/CR
//   \x7F-\x9F                   DEL + C1 controls
//   ​-‏               zero-width space..joiner, LRM/RLM
//   ‪-‮               bidi embeddings/overrides
//   ⁠-⁤ ⁦-⁯ word joiner, invisibles, bidi isolates
//   ﻿                      BOM / zero-width no-break space
// eslint-disable-next-line no-control-regex
const DANGEROUS_CHARS =
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;

// Accent-insensitive literal: each letter that has accented forms in Spanish or
// Portuguese becomes a character class, so "actúa", "actua" and "ACTÚA" all
// match (the patterns are compiled with the `i` flag). Only plain letters are
// expanded; callers pass literal words, never regex syntax.
const ACCENT_CLASSES: Record<string, string> = {
  a: '[aáàâãä]',
  e: '[eéèêë]',
  i: '[iíìîï]',
  o: '[oóòôõö]',
  u: '[uúùûü]',
  n: '[nñ]',
  c: '[cç]',
};
function fold(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split('')
    .map((ch) => ACCENT_CLASSES[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('');
}
/** Accent-insensitive alternation of literal words/phrases (spaces ⇒ \s+). */
function anyOf(...phrases: string[]): string {
  return `(?:${phrases.map((p) => p.split(' ').map(fold).join('\\s+')).join('|')})`;
}
const WS = '\\s+';
// Word edges that also treat accented Latin letters as letters (JS `\b` is
// ASCII-only, so it would see a boundary inside "é" and none after it).
const START = '(?<![A-Za-z\\u00C0-\\u024F])';
const END = '(?![A-Za-z\\u00C0-\\u024F])';

// Spanish / Portuguese building blocks.
const ES_PT_IGNORE = anyOf('ignora', 'ignore', 'ignorar', 'ignoren', 'descarta', 'descarte', 'descartar', 'desconsidera', 'desconsidere');
const ES_PT_FORGET = anyOf('olvida', 'olvide', 'olvidar', 'olviden', 'esquece', 'esqueça', 'esquecer');
const ES_PT_ALL_THE = `(?:${anyOf('todas las', 'todas as', 'las', 'as', 'todas', 'tus', 'suas', 'tuas')}${WS})?`;
const ES_PT_INSTRUCTIONS = anyOf('instrucciones', 'instruccion', 'instruções', 'instrução', 'indicaciones', 'ordenes', 'prompt');
const ES_PT_PREVIOUS = anyOf('anteriores', 'anterior', 'previas', 'previos', 'prévias', 'de arriba', 'de acima', 'acima', 'precedentes');
const ES_PT_EVERYTHING_BEFORE = anyOf('todo lo anterior', 'todo lo que', 'todo o que', 'tudo o que', 'tudo acima', 'tudo antes', 'tudo o anterior', 'todo lo de arriba');
const ES_PT_NOW = anyOf('ahora', 'a partir de ahora', 'desde ahora', 'agora', 'a partir de agora', 'de ahora en adelante', 'de agora em diante');
const ES_PT_ACT_AS = anyOf('actua como', 'actue como', 'actuar como', 'aja como', 'atue como', 'age como');
const ES_PT_YOU_ARE = anyOf('eres', 'voce e', 'tu es');

// Conservative prompt-injection markers. Kept tight to avoid mangling genuine
// CV/job-description prose; each is a phrase that only appears when someone is
// trying to override the system prompt. English, Spanish and Portuguese (the
// platform's candidate languages); the Spanish/Portuguese ones match with or
// without accents.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+|the\s+)?(?:previous|prior|above|preceding)\s+instructions?/gi,
  /disregard\s+(?:all\s+|the\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?)/gi,
  /forget\s+(?:everything|all)\s+(?:above|before)/gi,
  /new\s+instructions?\s*:/gi,
  /system\s+prompt\s*:/gi,
  // Role markers at the start of a line (system:/assistant:/human: hijacks).
  /^[ \t]*(?:system|assistant|human|user)\s*:/gim,
  // ES/PT: "ignora (todas) las instrucciones anteriores", "ignore as instruções anteriores".
  new RegExp(`${START}${ES_PT_IGNORE}${WS}${ES_PT_ALL_THE}${ES_PT_INSTRUCTIONS}${WS}${ES_PT_PREVIOUS}${END}`, 'gi'),
  // ES/PT: "olvida las instrucciones anteriores", "esqueça as instruções anteriores".
  new RegExp(`${START}${ES_PT_FORGET}${WS}${ES_PT_ALL_THE}${ES_PT_INSTRUCTIONS}${WS}${ES_PT_PREVIOUS}${END}`, 'gi'),
  // ES/PT: "olvida todo lo anterior", "ignora todo lo anterior", "esqueça tudo o que…".
  new RegExp(`${START}(?:${ES_PT_FORGET}|${ES_PT_IGNORE})${WS}${ES_PT_EVERYTHING_BEFORE}${END}`, 'gi'),
  // ES/PT: "nuevas instrucciones:", "novas instruções:", "instrucciones nuevas:".
  new RegExp(`${START}(?:${anyOf('nuevas', 'nueva', 'novas', 'nova')}${WS}${ES_PT_INSTRUCTIONS}|${ES_PT_INSTRUCTIONS}${WS}${anyOf('nuevas', 'novas')})\\s*:`, 'gi'),
  // ES/PT: "prompt del sistema:", "instrucciones del sistema:", "prompt do sistema:".
  new RegExp(`${START}${anyOf('prompt', 'instrucciones', 'instruções', 'mensaje', 'mensagem')}${WS}${anyOf('del', 'de', 'do')}${WS}${fold('sistema')}\\s*:`, 'gi'),
  // ES/PT role hijack, only when anchored by "now": "ahora actúa como", "a partir de agora aja como".
  new RegExp(`${START}${ES_PT_NOW}${WS}(?:,\\s*)?${ES_PT_ACT_AS}${END}`, 'gi'),
  // ES/PT: "eres ahora" / "ahora eres" / "você agora é" / "agora você é".
  new RegExp(`${START}(?:${ES_PT_YOU_ARE}${WS}${ES_PT_NOW}|${ES_PT_NOW}${WS}${ES_PT_YOU_ARE}|${anyOf('voce agora e', 'tu agora es')})${END}`, 'gi'),
  // ES/PT role markers at the start of a line (sistema:/asistente:/usuario:).
  new RegExp(`^[ \\t]*${anyOf('sistema', 'asistente', 'assistente', 'usuario', 'humano')}\\s*:`, 'gim'),
];

/**
 * Sanitize free-text user input before it is sent to Bedrock as DATA.
 * Removes dangerous characters, defangs known injection markers, collapses
 * runaway whitespace, and bounds the length. Idempotent.
 */
export function sanitizeInput(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  // NFC first so a decomposed accent ("a" + U+0301) cannot slip past the
  // accent-insensitive patterns; NFC is visually identical to the input.
  let out = text.normalize('NFC').replace(DANGEROUS_CHARS, '');
  for (const pattern of INJECTION_PATTERNS) {
    out = out.replace(pattern, '[filtered]');
  }
  // Collapse 3+ consecutive newlines (a padding trick to push instructions out
  // of a truncation window) down to a single blank line.
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.trim();
  if (out.length > maxLength) out = out.slice(0, maxLength);
  return out;
}

/**
 * Wrap user content in an XML delimiter that it cannot break out of: any
 * occurrence of the wrapper tag (opening or closing) inside the content is
 * neutralized first. Tag-aware, so unrelated angle brackets in the text (e.g.
 * "C++ < C#") are left untouched. Content is sanitized as part of wrapping.
 */
export function wrapAsData(tag: string, content: string): string {
  const delimiter = new RegExp(`</?\\s*${tag}\\b[^>]*>`, 'gi');
  const safe = sanitizeInput(content).replace(delimiter, '[delimiter]');
  return `<${tag}>\n${safe}\n</${tag}>`;
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// A run of digits with phone-style separators (it may hold several numbers: "8888-7777 8888-6666").
// Never across a line break: separate CV lines are separate facts.
// Separators include no-break/thin spaces and every dash ("8888\u00a07777", "2020\u20132024").
const DIGIT_RUN = /\+?\(?\d[\d \t\u00a0\u2007\u2009\u200a\u202f().\-\u2010-\u2015\u2212]*\d/g;
// "2019-2023" in a CV is a period, not a phone; protected before digit runs are masked.
const YEAR_RANGE = /(?<!\d)(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}(?!\d)/g;
const PHONE_MIN_DIGITS = 8;
// A year range is NOT a period when the text right before it says it is a phone ("Tel: 2020-2024") or it
// continues a digit run ("+506 2020-2024"): then it is left to the phone masking below.
const PHONE_LABEL_BEFORE =
  /(?:tel|tel[eé]fono|telefone|cel|celular|m[oó]vil|movil|phone|mobile|whatsapp|wa|fax|contacto|contact)\.?\s*(?:n[oº°]\.?\s*)?[:#]?\s*$/i;
const DIGIT_RUN_BEFORE = /[\d+][ \t\u00a0\u2007\u2009\u200a\u202f.\-\u2010-\u2015\u2212]*$/;

// Name particles never masked on their own ("de", "del" are ordinary words).
const NAME_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos', 'van', 'von', 'di', 'le']);

/** A term and its separate words, longest first, without particles or 1-2 letter fragments. */
function redactionVariants(terms: readonly string[]): string[] {
  const out = new Set<string>();
  for (const term of terms) {
    const whole = term.normalize('NFC').replace(DANGEROUS_CHARS, '').trim().replace(/\s+/g, ' ');
    if (whole.length >= 3) out.add(whole);
    for (const part of whole.split(' ')) {
      if (part.length >= 3 && !NAME_PARTICLES.has(part.toLowerCase())) out.add(part);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Private-use placeholder for the i-th protected span: no digits, so it can never join a digit run. */
const placeholder = (i: number) => `\uE000${i.toString(26).replace(/\d/g, (d) => 'qrstuvwxyz'[Number(d)]!)}\uE001`;

/**
 * Data minimization for free text about a candidate (e.g. a parsed CV summary) before it is sent to a
 * model that does not need to know who the person is: masks e-mail addresses, every run of 8+ digits
 * (phone numbers, alone or several in a row; year ranges such as "2019-2023" are kept) and the given
 * literal terms (the candidate's own names, whole and word by word, skipping particles such as "de"),
 * whole-word, case- and accent-insensitive. Run it BEFORE sanitizeInput / wrapAsData.
 */
export function redactContactDetails(text: string, terms: readonly string[] = []): string {
  // Invisible and control characters go FIRST: removed later (by sanitizeInput / wrapAsData) they would
  // re-join a phone number or a name this function failed to recognise ("8888\u200b7777", "Jo\u200bse").
  let out = text.normalize('NFC').replace(DANGEROUS_CHARS, '').replace(EMAIL_PATTERN, '[email]');
  const kept: string[] = [];
  out = out.replace(YEAR_RANGE, (range: string, offset: number, whole: string) => {
    const before = whole.slice(Math.max(0, offset - 32), offset).split('\n').pop() ?? '';
    if (PHONE_LABEL_BEFORE.test(before) || DIGIT_RUN_BEFORE.test(before)) return range;
    kept.push(range);
    return placeholder(kept.length - 1);
  });
  out = out.replace(DIGIT_RUN, (run) => (run.replace(/\D/g, '').length >= PHONE_MIN_DIGITS ? '[teléfono]' : run));
  kept.forEach((range, i) => {
    out = out.replace(placeholder(i), range);
  });
  for (const term of redactionVariants(terms)) {
    const pattern = term
      .split(' ')
      .map((word) => fold(word.toLowerCase()))
      .join('\\s+');
    out = out.replace(new RegExp(`${START}${pattern}${END}`, 'giu'), '[nombre]');
  }
  return out;
}

// Declared as a `type` (not `interface`) so it carries an implicit index
// signature and stays assignable to the AI SDK's providerOptions, which expects
// Record<string, JSONValue>.
export type BedrockGuardrailConfig = {
  guardrailIdentifier: string;
  guardrailVersion: string;
  trace: 'enabled' | 'disabled';
};

/**
 * Build the Bedrock provider options carrying the Guardrail reference, or
 * `undefined` when no guardrail is provisioned (env-gated). Spread into
 * `generateText({ providerOptions })`. The MASK policy is defined in the AWS
 * guardrail itself; this only attaches the identifier + version.
 */
export function bedrockGuardrailOptions():
  | { bedrock: { guardrailConfig: BedrockGuardrailConfig } }
  | undefined {
  const guardrailIdentifier = process.env.BEDROCK_GUARDRAIL_ID;
  if (!guardrailIdentifier) return undefined;
  return {
    bedrock: {
      guardrailConfig: {
        guardrailIdentifier,
        guardrailVersion: process.env.BEDROCK_GUARDRAIL_VERSION ?? 'DRAFT',
        trace: 'enabled',
      },
    },
  };
}
