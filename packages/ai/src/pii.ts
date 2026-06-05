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

// Conservative prompt-injection markers. Kept tight to avoid mangling genuine
// CV/job-description prose; each is a phrase that only appears when someone is
// trying to override the system prompt.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+|the\s+)?(?:previous|prior|above|preceding)\s+instructions?/gi,
  /disregard\s+(?:all\s+|the\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?)/gi,
  /forget\s+(?:everything|all)\s+(?:above|before)/gi,
  /new\s+instructions?\s*:/gi,
  /system\s+prompt\s*:/gi,
  // Role markers at the start of a line (system:/assistant:/human: hijacks).
  /^[ \t]*(?:system|assistant|human|user)\s*:/gim,
];

/**
 * Sanitize free-text user input before it is sent to Bedrock as DATA.
 * Removes dangerous characters, defangs known injection markers, collapses
 * runaway whitespace, and bounds the length. Idempotent.
 */
export function sanitizeInput(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  let out = text.replace(DANGEROUS_CHARS, '');
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
