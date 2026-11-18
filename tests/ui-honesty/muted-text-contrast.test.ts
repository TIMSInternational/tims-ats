import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WEB = resolve(__dirname, '../../apps/web');

function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

function tokenValue(css: string, name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})\\s*;`).exec(css);
  if (!match?.[1]) throw new Error(`token ${name} not found`);
  return match[1];
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? tsxFiles(full) : full.endsWith('.tsx') ? [full] : [];
  });
}

describe('muted text colour meets WCAG AA (4.5:1)', () => {
  const css = readFileSync(join(WEB, 'app/globals.css'), 'utf8');

  // The dead duplicate --color-text-muted (a second :root block nothing read) was deleted in the HIG pass;
  // every text token that remains is checked instead.
  it.each(['--color-muted', '--color-secondary', '--color-primary'])(
    '%s on white and on the surface colour',
    (name) => {
      const value = tokenValue(css, name);
      expect(contrast(value, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(value, tokenValue(css, '--color-surface'))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each([
    ['--color-success', '--color-success-bg'],
    ['--color-warning', '--color-warning-bg'],
    ['--color-danger', '--color-danger-bg'],
    ['--color-info', '--color-info-bg'],
  ])('status text %s on %s passes 4.5:1', (fg, bg) => {
    expect(contrast(tokenValue(css, fg), tokenValue(css, bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('field borders pass the 3:1 non-text minimum on white', () => {
    expect(contrast(tokenValue(css, '--color-field-border'), '#FFFFFF')).toBeGreaterThanOrEqual(3);
  });

  it('white on the sidebar active row passes 4.5:1', () => {
    expect(contrast('#FFFFFF', tokenValue(css, '--chrome-accent-active'))).toBeGreaterThanOrEqual(4.5);
  });

  it('the candidate portal uses the token, not the old low-contrast hex', () => {
    const offenders = tsxFiles(join(WEB, 'app/(portal)')).filter((f) => /#8B8B8B/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
