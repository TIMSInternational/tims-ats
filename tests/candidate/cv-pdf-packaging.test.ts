/**
 * F-7: PDF CVs never parsed in production while pdf-parse was compiled into the Next.js
 * server bundle. The web app now loads pdf-parse as a plain Node package. That only
 * holds while ALL of these stay true, and each one fails silently on its own:
 *
 * 1. apps/web/next.config.ts lists pdf-parse in serverExternalPackages.
 * 2. pdf-parse RESOLVES from apps/web: Next keeps a listed package external only if the app
 *    root resolves it to the same file (handle-externals.js base-resolve check); otherwise
 *    it bundles it anyway, with no warning.
 * 3. apps/web and packages/api declare the same spec, so the lockfile keeps one copy.
 * 4. Output file tracing includes the pdf.js build cv-extraction.ts pins, because pdf-parse
 *    requires it through a template-literal path.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { PDFJS_BUILD_VERSION, extractCvText } from '../../packages/api/src/lib/cv-extraction';

const ROOT = resolve(__dirname, '../..');
const WEB = join(ROOT, 'apps/web');
const nextConfig = readFileSync(join(WEB, 'next.config.ts'), 'utf8');

type PdfParse = (
  data: Uint8Array,
  options?: { version?: string },
) => Promise<{ numpages: number; text: string; version: string }>;
type PdfKitDoc = {
  on(event: 'data', cb: (chunk: Buffer) => void): void;
  on(event: 'end', cb: () => void): void;
  text(s: string): void;
  end(): void;
};

function dependencySpec(pkgJsonPath: string): string | undefined {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { dependencies?: Record<string, string> };
  return pkg.dependencies?.['pdf-parse'];
}

describe('pdf-parse packaging for the Next.js server (F-7)', () => {
  it('is listed in serverExternalPackages', () => {
    const list = /serverExternalPackages:\s*\[([^\]]*)\]/.exec(nextConfig)?.[1] ?? '';
    expect(list).toMatch(/["']pdf-parse["']/);
  });

  it('is an apps/web dependency with the same spec as packages/api', () => {
    const api = dependencySpec(join(ROOT, 'packages/api/package.json'));
    expect(api).toBeDefined();
    expect(dependencySpec(join(WEB, 'package.json'))).toBe(api);
  });

  it('has exactly one version in the lockfile', () => {
    const lock = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');
    const versions = new Set([...lock.matchAll(/^ {2}pdf-parse@([^:(\s]+):$/gm)].map((m) => m[1]));
    expect([...versions]).toHaveLength(1);
  });

  it('traces the pinned pdf.js build, which exists in the installed package', () => {
    const webRequire = createRequire(join(WEB, 'package.json'));
    const pkgDir = dirname(webRequire.resolve('pdf-parse/package.json'));
    for (const file of ['pdf.js', 'pdf.worker.js']) {
      const rel = `pdf-parse/lib/pdf.js/${PDFJS_BUILD_VERSION}/build/${file}`;
      expect(nextConfig).toMatch(new RegExp(`node_modules/${rel.replace(/\./g, '\\.')}["']`));
      expect(existsSync(join(pkgDir, 'lib/pdf.js', PDFJS_BUILD_VERSION, 'build', file))).toBe(true);
    }
  });

  it('parses a PDF through pdf-parse resolved from apps/web, as the server will', async () => {
    const pdf = await smallPdf();

    const pdfParse = createRequire(join(WEB, 'package.json'))('pdf-parse') as PdfParse;
    const result = await pdfParse(new Uint8Array(pdf), { version: PDFJS_BUILD_VERSION });

    expect(result.numpages).toBe(1);
    expect(result.version).toBe(PDFJS_BUILD_VERSION.slice(1));
    expect(result.text).toContain(PDF_TEXT);
  });

  // pdf.js 1.10 reads PDF streams from `bytes.buffer` ignoring byteOffset, and copies a Buffer input
  // into another pooled Buffer: a small PDF passed as a Buffer failed about half the time. Each run
  // first takes a byte from Node's shared pool so the next small Buffer lands at a nonzero offset.
  it('extracts a small (pool-sized) PDF reliably through extractCvText', async () => {
    const pdf = await smallPdf();
    expect(pdf.length).toBeLessThan(Buffer.poolSize >>> 1);
    for (let i = 0; i < 10; i++) {
      Buffer.from([i]);
      await expect(extractCvText(Buffer.from(pdf), 'application/pdf')).resolves.toContain(PDF_TEXT);
    }
  });
});

const PDF_TEXT = 'Hoja de vida de prueba 2026';

function smallPdf(): Promise<Buffer> {
  const apiRequire = createRequire(join(ROOT, 'packages/api/package.json'));
  const PDFDocument = apiRequire('pdfkit') as new () => PdfKitDoc;
  return new Promise<Buffer>((done) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => done(Buffer.concat(chunks)));
    doc.text(PDF_TEXT);
    doc.end();
  });
}
