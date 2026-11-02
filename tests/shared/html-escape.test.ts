/**
 * html-escape.test.ts — WP-04 PR H (platform-owner-journeys-41).
 *
 * A shared escapeHtml helper for values that are interpolated into HTML email bodies. It must
 * escape the five characters that are significant in HTML text and quoted attribute contexts,
 * escape `&` first (so it is never double-escaped by its own output), and leave other text alone.
 */
import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../../packages/shared/src/html-escape';
import * as shared from '../../packages/shared/src/index';

describe('escapeHtml', () => {
  it('escapes each of & < > " \'', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('escapes markup so it renders as text', () => {
    expect(escapeHtml('<b>Acme</b>')).toBe('&lt;b&gt;Acme&lt;/b&gt;');
  });

  it('escapes & exactly once (no double escaping of its own output)', () => {
    expect(escapeHtml('a & b <c>')).toBe('a &amp; b &lt;c&gt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves plain and accented text unchanged', () => {
    expect(escapeHtml('Compañía Ñandú S.A. 123')).toBe('Compañía Ñandú S.A. 123');
    expect(escapeHtml('')).toBe('');
  });

  it('is exported from the @tims/shared barrel', () => {
    expect((shared as Record<string, unknown>).escapeHtml).toBe(escapeHtml);
  });
});
