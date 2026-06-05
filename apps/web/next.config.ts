import type { NextConfig } from "next";

// Dev (Turbopack/HMR) needs 'unsafe-eval'; production builds do not, so drop it
// there to shrink the XSS attack surface. 'unsafe-inline' stays until a full
// nonce-based CSP migration lands (removing it without nonces breaks Next's
// inline bootstrap scripts). challenges.cloudflare.com is allowed for the
// optional Turnstile CAPTCHA on the public apply form.
const isProd = process.env.NODE_ENV === "production";
const scriptSrc = isProd
  ? "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com"
  : "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://challenges.cloudflare.com";

const nextConfig: NextConfig = {
  devIndicators: false,
  transpilePackages: [
    "@tims/api",
    "@tims/auth",
    "@tims/db",
    "@tims/shared",
    "@tims/ui",
    "@tims/i18n",
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              scriptSrc,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com https://*.cloudfront.net",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://accounts.google.com https://login.microsoftonline.com https://*.daily.co wss://*.daily.co https://*.wss.daily.co https://challenges.cloudflare.com https://*.sentry.io",
              "frame-src 'self' https://accounts.google.com https://login.microsoftonline.com https://*.daily.co https://challenges.cloudflare.com",
              "media-src 'self' blob: https://*.daily.co",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
