import 'server-only';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LEGAL_DRAFT_MARKER, type LegalDocumentSlug, type LegalLocale } from './documents';

export interface LegalDocumentContent {
  /** Raw Markdown (rendered by `MarkdownText`, which never emits HTML). */
  source: string;
  /** Text of the first `# ` heading, used as the page title. */
  title: string;
  /** True while the file still carries a TODO-for-counsel marker. */
  isDraft: boolean;
}

export type LegalDocumentBundle = Record<LegalLocale, LegalDocumentContent>;

/** Hard cap on a content file: legal text is long, but this is far above any real document. */
const MAX_CONTENT_BYTES = 200_000;

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
  const source = raw.slice(0, MAX_CONTENT_BYTES).replace(/\r\n?/g, '\n');
  return { source, title: extractTitle(source), isDraft: source.includes(LEGAL_DRAFT_MARKER) };
}

export async function loadLegalDocument(slug: LegalDocumentSlug): Promise<LegalDocumentBundle> {
  const [es, en] = await Promise.all([loadOne(slug, 'es'), loadOne(slug, 'en')]);
  return { es, en };
}
