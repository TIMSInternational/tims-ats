// Do NOT barrel-export server.ts here — it imports next/headers which breaks client components.
// Import from '@tims/auth/server', '@tims/auth/client', or '@tims/auth/middleware' directly.

export { createSupabaseBrowserClient } from './client';
