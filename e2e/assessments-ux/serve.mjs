// Serves the assessments UX harness (harness/index.html): the REAL apps/web components, bundled by Vite with only the
// Next.js runtime and the tRPC/auth plumbing stubbed (harness/stubs). Every C# Platform call still goes through the
// real platform-api client to /api/platform/..., which the Playwright spec answers with a mocked provider. Local only.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const web = resolve(root, 'apps/web');
// vite is not a declared dependency of @tims/e2e: borrow the copy the repo's vitest already uses.
const fromVitest = createRequire(createRequire(resolve(root, 'package.json')).resolve('vitest/package.json'));
const { createServer } = await import(fromVitest.resolve('vite'));
const react = (await import(createRequire(resolve(root, 'package.json')).resolve('@vitejs/plugin-react'))).default;

const port = Number(process.env.ASSESSMENTS_UX_PORT ?? 4317);
const stub = (name) => resolve(here, 'harness/stubs', name);

// Replaces whole modules of apps/web by their resolved file (imports are relative, so a specifier alias cannot).
const STUBBED_FILES = [
  [resolve(web, 'lib/trpc.ts'), stub('trpc.tsx')],
  [resolve(web, 'lib/permissions.tsx'), stub('permissions.tsx')],
];
const STUBBED_SPECIFIERS = {
  '@tims/auth/client': stub('auth-client.ts'),
  '@sentry/nextjs': stub('sentry.ts'),
  'next/link': stub('next-link.tsx'),
  'next/navigation': stub('next-navigation.ts'),
  recharts: stub('recharts.tsx'),
};

const server = await createServer({
  configFile: false,
  root: resolve(here, 'harness'),
  logLevel: 'warn',
  plugins: [
    react(),
    {
      name: 'assessments-ux-stubs',
      enforce: 'pre',
      async resolveId(source, importer, options) {
        if (source in STUBBED_SPECIFIERS) return STUBBED_SPECIFIERS[source];
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        const hit = resolved && STUBBED_FILES.find(([file]) => resolved.id === file);
        return hit ? hit[1] : null;
      },
    },
  ],
  resolve: {
    // One React and one react-query for the harness and the components.
    alias: {
      react: resolve(web, 'node_modules/react'),
      'react-dom': resolve(web, 'node_modules/react-dom'),
      '@tanstack/react-query': resolve(web, 'node_modules/@tanstack/react-query'),
    },
  },
  define: {
    'process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL': JSON.stringify('https://csharp.invalid'),
    'process.env.NEXT_PUBLIC_ASSESSMENT_PROVIDERS_VIA_CSHARP': JSON.stringify('true'),
    'process.env.NEXT_PUBLIC_FIT_ENGINE_V2_VIA_CSHARP': JSON.stringify('true'),
    'process.env.NEXT_PUBLIC_LAUNCH_SCOPE': JSON.stringify(''),
    'process.env.NODE_ENV': JSON.stringify('development'),
  },
  server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [root] } },
});
await server.listen();
console.log(`assessments-ux harness on http://127.0.0.1:${port}`);
