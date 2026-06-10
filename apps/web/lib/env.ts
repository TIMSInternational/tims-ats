import 'server-only';
import { z } from 'zod';

// Optional secret that treats an empty string (a common Vercel / .env placeholder)
// the same as absent — so an unset-but-present-empty var never fails validation.
const optionalSecret = () =>
  z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional());

const envSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // Database
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),

  // AWS
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),

  // Platform
  PLATFORM_EMAIL_FROM: z.string().email().default('noreply@nexadev.ai'),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  // Upstash Redis (rate limiting — optional for local dev)
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  // Cloudflare Turnstile (CAPTCHA on public apply form — optional; enforced only
  // when both keys are set)
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),

  // Stripe billing (Wave 2 — optional; tenant billing is "configured" only when
  // the secret key AND both self-serve price ids are present, else endpoints fail
  // closed and the UI hides Upgrade/Manage). Built/verified in test mode; live keys
  // are a deploy handoff. STRIPE_WEBHOOK_SECRET arrives with the webhook (Slice 2).
  // Empty string (a common Vercel/.env placeholder) is coerced to "absent".
  STRIPE_SECRET_KEY: optionalSecret(),
  STRIPE_PRICE_STARTER: optionalSecret(),
  STRIPE_PRICE_PROFESSIONAL: optionalSecret(),

  // Vercel Cron shared secret. The alert-evaluation cron route requires
  // `Authorization: Bearer <CRON_SECRET>`; unset ⇒ the route 401s (fail-closed).
  CRON_SECRET: z.string().min(1).optional(),

  // MFA enforcement (opt-in). When 'true', platform owners + super_admins must
  // step up to a verified TOTP factor (Supabase Auth MFA, aal2) before reaching
  // any admin route. Default off so a fresh deploy can never lock admins out.
  MFA_ENFORCED: z.enum(['true', 'false']).optional(),

  // Node
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('Invalid environment variables:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Invalid environment variables');
    }
  }

  return parsed.data ?? (process.env as unknown as Env);
}

export const env = validateEnv();
