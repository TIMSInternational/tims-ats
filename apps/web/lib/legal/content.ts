import 'server-only';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LEGAL_DRAFT_MARKER, LEGAL_MAX_CONTENT_CHARS, type LegalDocumentSlug, type LegalLocale } from './documents';

export interface LegalDocumentContent {
  /** Raw Markdown (rendered by `MarkdownText`, which never emits HTML). */
  source: string;
  /** Text of the first `# ` heading, used as the page title. */
  title: string;
  /** True while the file still carries a TODO-for-counsel marker. */
  isDraft: boolean;
}

export type LegalDocumentBundle = Record<LegalLocale, LegalDocumentContent>;

export class LegalContentTooLongError extends Error {
  constructor(slug: string, locale: string) {
    super(`legal content ${locale}/${slug}.md exceeds ${LEGAL_MAX_CONTENT_CHARS} characters`);
    this.name = 'LegalContentTooLongError';
  }
}

// `next start` / Vercel run with cwd = apps/web; vitest runs from the repo root. The files are
// shipped with the serverless function via `outputFileTracingIncludes` in next.config.ts.
function contentRoot(): string {
  const appDir = path.join(process.cwd(), 'content', 'legal');
  const repoRootDir = path.join(process.cwd(), 'apps', 'web', 'content', 'legal');
  return existsSync(appDir) ? appDir : repoRootDir;
}

function extractTitle(source: string): string {
  const line = source.split('\n').find((l) => /^#\s+/.test(l.trim()));
  return line ? line.trim().replace(/^#\s+/, '').trim() : '';
}

async function loadOne(slug: LegalDocumentSlug, locale: LegalLocale): Promise<LegalDocumentContent> {
  // `slug` and `locale` are both narrowed to closed allow-lists by the type system and by the
  // page's `isLegalDocumentSlug` check, so no request-controlled string reaches the path.
  const raw = await readFile(path.join(contentRoot(), locale, `${slug}.md`), 'utf8');
  const source = raw.replace(/\r\n?/g, '\n');
  if (source.length > LEGAL_MAX_CONTENT_CHARS) throw new LegalContentTooLongError(slug, locale);
  return { source, title: extractTitle(source), isDraft: source.includes(LEGAL_DRAFT_MARKER) };
}

export async function loadLegalDocument(slug: LegalDocumentSlug): Promise<LegalDocumentBundle> {
  const [es, en] = await Promise.all([loadOne(slug, 'es'), loadOne(slug, 'en')]);
  return { es, en };
}
