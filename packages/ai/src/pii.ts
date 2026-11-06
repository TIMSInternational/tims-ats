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

// Whitespace (incl. line breaks from PDF extraction) is allowed around "@" and the dots of the domain:
// "recruiting123@\nexample.com", "ana @ acme . com". Over-masking a word after "x@y. " is accepted.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+\s*@\s*[A-Za-z0-9-]+(?:\s*\.\s*[A-Za-z0-9-]+)*\s*\.\s*[A-Za-z]{2,}/g;
// A run of digits with phone-style separators (it may hold several numbers: "8888-7777 8888-6666").
// Separators include line breaks (PDF extraction wraps "+506 8888\n7777"), no-break/thin spaces, every
// dash and the slash ("8888\u00a07777", "2020\u20132024", "8888/7777"). Over-masking two numbers on
// consecutive lines is accepted; leaking a wrapped phone is not.
const DIGIT_RUN = /\+?\(?\d[\d \t\r\n\u00a0\u2007\u2009\u200a\u202f()./\-\u2010-\u2015\u2212]*\d/g;
// Every run of 8+ digits is masked, year ranges included ("2019-2023"): a phone can take any shape, so no
// digit pattern is exempt. Structured dates (e.g. a CV's start/end years) must be added AFTER redaction.
const PHONE_MIN_DIGITS = 8;
// A phone label followed by a number of 7+ digits (the label is kept, the number masked).
const LABELLED_PHONE =
  /((?:tel|tel[eé]fono|telefone|cel|celular|m[oó]vil|phone|mobile|whatsapp|fax|contacto|contact)\.?\s*(?:n[oº°]\.?\s*)?[:#]?\s*)(\+?\(?\d[\d \t\r\n\u00a0\u2007\u2009\u200a\u202f()./\-\u2010-\u2015\u2212]*\d)/giu;

/** Every Unicode decimal digit (\p{Nd}) as its ASCII digit, so the digit patterns see all scripts. */
function asciiDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (d) => {
    if (d >= '0' && d <= '9') return d;
    const cp = d.codePointAt(0)!;
    // Mathematical digits (U+1D7CE–U+1D7FF) are five 0–9 blocks back to back.
    if (cp >= 0x1d7ce && cp <= 0x1d7ff) return String((cp - 0x1d7ce) % 10);
    // Unicode lays out every decimal-digit block as 10 consecutive code points starting at its zero.
    for (let zero = cp; zero > cp - 10; zero--) {
      if (/\p{Nd}/u.test(String.fromCodePoint(zero)) && !/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) {
        return String(cp - zero);
      }
    }
    return d;
  });
}

// Name particles never masked on their own ("de", "del" are ordinary words).
const NAME_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos', 'van', 'von', 'di', 'le']);

/**
 * The supplied names, their combined full name, and every word in them, longest first. Every component is
 * masked whatever its length ("Li", "Wu", "王"); only the explicit particles above are never masked alone.
 */
function redactionVariants(terms: readonly string[]): string[] {
  const out = new Set<string>();
  const clean = (t: string) => t.normalize('NFC').replace(DANGEROUS_CHARS, '').trim().replace(/\s+/g, ' ');
  const wholes = terms.map(clean).filter((w) => w.length > 0);
  if (wholes.length > 1) out.add(wholes.join(' '));
  for (const whole of wholes) {
    if (!NAME_PARTICLES.has(whole.toLowerCase())) out.add(whole);
    // Components split on spaces AND hyphens ('Ana-María' → 'Ana', 'María').
    for (const part of whole.split(/[\s\-\u2010-\u2015]+/)) {
      if (part.length > 0 && !NAME_PARTICLES.has(part.toLowerCase())) out.add(part);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * Data minimization for free text about a candidate (e.g. a parsed CV summary) before it is sent to a
 * model that does not need to know who the person is: masks e-mail addresses, every run of 8+ digits
 * (phone numbers in any format; year ranges such as "2019-2023" too — add structured dates after this),
 * and the given names (whole, as the combined full name, and word by word at any length, skipping
 * particles such as "de"), whole-word, case- and accent-insensitive. Invisible and control characters are
 * removed first. Run it BEFORE sanitizeInput / wrapAsData.
 */
export function redactContactDetails(text: string, terms: readonly string[] = []): string {
  // Invisible and control characters go FIRST: removed later (by sanitizeInput / wrapAsData) they would
  // re-join a phone number or a name this function failed to recognise ("8888\u200b7777", "Jo\u200bse").
  // Every Unicode decimal digit (Arabic-Indic "٢٠٢", full-width "２０２"…) is read as its ASCII digit.
  let out = asciiDigits(text.normalize('NFC').replace(DANGEROUS_CHARS, '')).replace(EMAIL_PATTERN, '[email]');
  // A number right after a phone label is masked from 7 digits ("Tel: 555-1234"); any other run from 8.
  out = out.replace(LABELLED_PHONE, (_m, label: string) => `${label}[teléfono]`);
  out = out.replace(DIGIT_RUN, (run) => (run.replace(/\D/g, '').length >= PHONE_MIN_DIGITS ? '[teléfono]' : run));
  for (const term of redactionVariants(terms)) out = maskName(out, term);
  return out;
}

/** Lower-case base letters of one character (all diacritics removed, any script): "ř" → "r", "Á" → "a". */
function baseOf(ch: string): string {
  return ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Replace every whole-word occurrence of `term` in `text` with "[nombre]", ignoring case and ALL diacritics
 * on both sides ("Dvořák" ⇔ "Dvorak", "José" ⇔ "JOSE"), any run of whitespace matching a space. Matching
 * runs on a diacritic-free copy whose characters map back to the original, so the original text is cut.
 */
function maskName(text: string, term: string): string {
  const chars = [...text];
  let base = '';
  // One entry per UTF-16 code UNIT of `base` (regex indices count code units, not code points), each
  // pointing at the code point in `chars` it came from — so emoji or other astral characters before a name
  // can never shift the masked span.
  const origin: number[] = [];
  chars.forEach((ch, i) => {
    const b = baseOf(ch);
    base += b;
    for (let unit = 0; unit < b.length; unit++) origin.push(i);
  });
  const words = term.split(' ').map((w) => [...w].map(baseOf).join('').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.every((w) => w.length === 0)) return text;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${words.join('\\s+')}(?![\\p{L}\\p{N}])`, 'gu');
  const spans: Array<[number, number]> = [];
  for (const m of base.matchAll(re)) {
    const start = origin[m.index!]!;
    const end = origin[m.index! + m[0].length - 1]! + 1;
    spans.push([start, end]);
  }
  for (const [start, end] of spans.reverse()) chars.splice(start, end - start, '[nombre]');
  return chars.join('');
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
