import { z } from 'zod';

// Client-side twins of the portal.applyToVacancy input rules (packages/api/src/routers/portal.ts):
// the same zod validators, so a value the form accepts is never rejected by the server with a
// generic error after the candidate reaches the last step.
const emailSchema = z.string().email().max(320);
const urlSchema = z.string().url().max(2048);

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function isValidApplyEmail(value: string): boolean {
  return emailSchema.safeParse(value.trim()).success;
}

/** "linkedin.com/in/ana" or "www.linkedin.com/in/ana" → "https://…"; empty stays empty. */
export function normalizeLinkedinUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Empty (the field is optional) or an http(s) URL the server's `z.string().url()` accepts. */
export function isValidLinkedinUrl(value: string): boolean {
  const normalized = normalizeLinkedinUrl(value);
  if (!normalized) return true;
  return /^https?:\/\//i.test(normalized) && urlSchema.safeParse(normalized).success;
}
