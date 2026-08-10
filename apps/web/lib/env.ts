import 'server-only';
import { z } from 'zod';

// Optional secret that treats an empty string (a common Vercel / .env placeholder)
// the same as absent — so an unset-but-present-empty var never fails validation.
const optionalSecret = () => z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional());
const optionalUrl = () => z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional());

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

  // Daily.co human video interviews. Missing/blank key keeps the room-creation
  // endpoint fail-closed; DAILY_API_URL is optional for tests/proxies.
  DAILY_API_KEY: optionalSecret(),
  DAILY_API_URL: optionalUrl(),

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
  // Webhook signing secret. The /api/webhooks/stripe route fails closed (400) when
  // this is unset or the signature does not verify — an unverified event is never
  // processed.
  STRIPE_WEBHOOK_SECRET: optionalSecret(),
  // Stripe Billing Portal configuration id. When set, portal sessions use this
  // explicit configuration (created in the Stripe dashboard with subscription cancel
  // = at_period_end) instead of the account default — so the portal can never offer
  // an immediate destructive cancel. Configured at the deploy handoff.
  STRIPE_PORTAL_CONFIGURATION_ID: optionalSecret(),

  // Vercel Cron shared secret. The alert-evaluation cron route requires
  // `Authorization: Bearer <CRON_SECRET>`; unset ⇒ the route 401s (fail-closed).
  CRON_SECRET: z.string().min(1).optional(),

  // MFA enforcement (opt-in). When 'true', platform owners + super_admins must
  // step up to a verified TOTP factor (Supabase Auth MFA, aal2) before reaching
  // any admin route. Default off so a fresh deploy can never lock admins out.
  MFA_ENFORCED: z.enum(['true', 'false']).optional(),

  // §8 Q0b slice 2 (#172). Route the alert cron's `active_surveys` and
  // `pending_salary_adjustments` reads to the C# platform service instead of Prisma —
  // required once ownership flips #64/#66 delete those Prisma models. Exact 'true' only;
  // unset ⇒ Prisma, which is the reversal path (no code change, no deploy).
  ALERT_METRICS_READ_VIA_CSHARP: z.enum(['true', 'false']).optional(),

  // The credential that cron path presents to the platform service as `X-Tims-Cron-Secret`.
  // DISTINCT from CRON_SECRET above: that one authenticates Vercel to this Next.js route,
  // this one authenticates this app to the platform service. Reusing one value across both
  // hops would mean a leak at either end grants both. Must match Platform:AlertMetricsCronSecret.
  // Min 32: the platform gate rejects anything shorter as unconfigured, because that route is
  // rate-limit exempt and the secret's own entropy is the only brute-force control.
  ALERT_METRICS_CRON_SECRET: z.string().min(32).optional(),

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
