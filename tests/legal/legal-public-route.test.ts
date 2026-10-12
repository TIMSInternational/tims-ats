import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../../apps/web/node_modules/next/server';

vi.mock('@tims/auth/middleware', () => ({
  updateSession: async () => ({ supabaseResponse: new Response(null), user: null }),
}));

// Candidates and prospects read the legal pages without a session, so /legal/* must not bounce
// to staff /login (the page itself 404s while NEXT_PUBLIC_LEGAL_PAGES_ENABLED is off).
describe('middleware: /legal is public', () => {
  it.each(['/legal/terms', '/legal/privacy', '/legal/subprocessors', '/legal/ai-processing'])(
    '%s is served to an anonymous visitor',
    async (path) => {
      const { middleware } = await import('../../apps/web/middleware');
      const res = await middleware(new NextRequest(`https://app.example.test${path}`));
      expect(res.headers.get('location')).toBeNull();
    },
  );

  it('segment-aware: /legalese is still protected', async () => {
    const { middleware } = await import('../../apps/web/middleware');
    const res = await middleware(new NextRequest('https://app.example.test/legalese'));
    expect(res.headers.get('location')).toContain('/login');
  });
});
