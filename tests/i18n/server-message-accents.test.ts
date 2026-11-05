import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Pilot audit E-15 / B-21 / C-23: Spanish messages built on the SERVER (TRPCError messages, C# error
// bodies, email subjects, notification titles) reach staff and candidates verbatim in toasts, pages and
// inboxes — "Ocurrio un error inesperado", "Debes iniciar sesion", "Verificacion de seguridad fallida".
// es.json has its own guard (es-accents.test.ts); nothing guarded the ~150 server strings, so they drifted.
//
// Scope: string literals in packages/api/src and services/Tims.Platform/src that read as Spanish copy.
// Comments and log lines are not copy. Two files are excluded on purpose:
//   - routers/platform/ai-agents.ts: the agent catalog seed — descriptions are data synced to DB rows.
//   - NineBox/Succession kernels: recommendation texts pinned by cross-stack contract fixtures
//     (contracts/succession-fixtures, packages/shared); changing them is a kernel-parity change.
//
// Only spellings that are NEVER correct Spanish belong in the word list (see es-accents.test.ts for why
// esta/está, mas/más, aun/aún, solo, etc. stay out).
const MISSPELLED_WORDS = [
  'ocurrio',
  'encontro',
  'automatico',
  'automatica',
  'electronico',
  'politica',
  'demas',
  'reunion',
  'pagina',
  'dia',
  'dias',
  'estan',
  'critico',
  'comite',
  'lider',
  'lideres',
  'codigo',
  'numero',
  'telefono',
  'titulo',
  'ultimo',
  'contrasena',
  'desempeno',
  'aqui',
  'linea',
];
// -ción / -sión words are always accented in Spanish; these English words share the ending and appear in
// code-ish literals (headers, identifiers) that also happen to contain a Spanish function word.
const CION_ALLOWLIST = new Set([
  'session',
  'sessions',
  'version',
  'versions',
  'decision',
  'decisions',
  'permission',
  'permissions',
  'submission',
  'submissions',
  'succession',
  'extension',
  'conversion',
  'precision',
  'expression',
]);
const CION = /\b[a-z]+(?:cion|sion)\b/gi;
const WORDS = new RegExp(`\\b(?:${MISSPELLED_WORDS.join('|')})\\b`, 'i');
// Interpolations, URLs and email addresses are not prose.
const NOT_COPY = /\$\{[^}]*\}|\{[^{}]*\}|https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.]+/g;
// A literal is treated as Spanish copy when it has an accented letter or a Spanish function word.
const SPANISH = /[áéíóúñ¿¡]|\b(?:de|la|los|las|no|para|por|una|del|en|se|con|ya|el|su|este|esta|sin|hay|un|al|que)\b/;
const LITERAL = /(?<![\w$])(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\\n]|\\.)*`)/g;
const SKIP_LINE = /^\s*(?:\/\/|\*|\/\*)|\blogger\.|\bconsole\.|_logger\.|\bLog(?:Warning|Information|Error|Debug)\b/;
const EXCLUDED_FILES = new Set(['ai-agents.ts', 'NineBoxKernels.cs', 'SuccessionKernels.cs']);
const SKIP_DIRS = new Set(['node_modules', 'bin', 'obj', 'dist', 'generated', 'Migrations']);

const ROOT = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIP_DIRS.has(name) ? [] : sourceFiles(path);
    if (!/\.(ts|cs)$/.test(name) || /\.test\.ts$/.test(name) || EXCLUDED_FILES.has(name)) return [];
    return [path];
  });
}

function isUnaccented(literal: string): boolean {
  const text = literal.slice(1, -1).replace(NOT_COPY, ' ');
  if (!text.includes(' ') || !SPANISH.test(text)) return false;
  if (WORDS.test(text)) return true;
  return (text.match(CION) ?? []).some((word) => !CION_ALLOWLIST.has(word.toLowerCase()));
}

function offendersIn(source: string): string[] {
  return source
    .split('\n')
    .flatMap((line) => (SKIP_LINE.test(line) ? [] : (line.match(LITERAL) ?? []).filter(isUnaccented)));
}

describe('server-side Spanish messages keep their accents (E-15)', () => {
  const files = [
    ...sourceFiles(join(ROOT, 'packages/api/src')),
    ...sourceFiles(join(ROOT, 'services/Tims.Platform/src')),
  ];

  it('walks both trees (guard against the walker silently matching nothing)', () => {
    expect(files.filter((f) => f.endsWith('.ts')).length).toBeGreaterThan(200);
    expect(files.filter((f) => f.endsWith('.cs')).length).toBeGreaterThan(200);
  });

  it('has no unaccented Spanish message in packages/api or the C# service', () => {
    const offenders = files.flatMap((file) =>
      offendersIn(readFileSync(file, 'utf8')).map((literal) => `${relative(ROOT, file)}: ${literal}`),
    );
    expect(offenders).toEqual([]);
  });

  it('the detector catches the defects it exists for', () => {
    expect(
      offendersIn(`throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Ocurrio un error inesperado.' });`),
    ).toHaveLength(1);
    expect(offendersIn(`message: 'Debes iniciar sesion para acceder a este recurso',`)).toHaveLength(1);
    expect(offendersIn(`private const string Msg = "Solo un miembro del comite puede votar";`)).toHaveLength(1);
    expect(offendersIn('title: `Invitacion sin aceptar - ${inv.email}`,')).toHaveLength(1);
  });

  it('does not flag correct Spanish, comments, logs or English protocol strings', () => {
    expect(offendersIn(`message: 'Ocurrió un error inesperado. Intenta de nuevo más tarde.',`)).toEqual([]);
    expect(offendersIn(`// TS throws 'Validacion no encontrada' here`)).toEqual([]);
    expect(offendersIn(`logger.warn('sesion de proctoring sin organizacion');`)).toEqual([]);
    expect(offendersIn(`'MIME-Version: 1.0',`)).toEqual([]);
    expect(offendersIn(`keywords: 'billing planes pagos facturacion stripe'`)).toEqual([]);
  });
});
