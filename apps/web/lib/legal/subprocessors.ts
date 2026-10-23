/**
 * Subprocessor inventory for /legal/subprocessors, derived from the vendors the code actually
 * calls (SDK imports, API hosts, env names, infrastructure). Every entry cites `evidence`:
 * a repo file plus a string that must appear in it. `tests/legal/subprocessor-inventory.test.ts`
 * fails when evidence goes stale, and when a new runtime dependency, .NET package or CSP host
 * appears without being classified here or in its explicit "not a data-processing vendor" list.
 *
 * Data categories describe what the code sends to the vendor, not contractual commitments.
 * Counsel owns the legal framing on the page (see content/legal/{es,en}/subprocessors.md),
 * including each vendor's contracting entity, processing location and transfer mechanism —
 * `vendor` here is the trading name, not a verified legal entity.
 */

export type SubprocessorCondition =
  /** Always in the request path of the deployed platform. */
  | 'always'
  /** Only when the operator configures the listed env vars; the code is inert without them. */
  | 'configured'
  /** Only when a customer organization enables the integration for its own account. */
  | 'customer-enabled';

export interface Localized {
  es: string;
  en: string;
}

export interface SubprocessorEvidence {
  /** Repo-relative path. */
  file: string;
  /** Literal string that must appear in `file`. */
  contains: string;
}

export interface Subprocessor {
  id: string;
  vendor: string;
  service: string;
  purpose: Localized;
  dataCategories: Localized;
  condition: SubprocessorCondition;
  /** Env vars whose presence activates a `configured` entry. */
  activatedBy?: readonly string[];
  evidence: readonly SubprocessorEvidence[];
}

export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    id: 'vercel',
    vendor: 'Vercel Inc.',
    service: 'Vercel',
    purpose: {
      es: 'Alojamiento de la aplicación web y de sus funciones de servidor.',
      en: 'Hosting of the web application and its server functions.',
    },
    dataCategories: {
      es: 'Todos los datos que se muestran o envían a través de la aplicación web, en tránsito; metadatos de solicitudes (dirección IP, agente de usuario).',
      en: 'All data displayed in or submitted through the web application, in transit; request metadata (IP address, user agent).',
    },
    condition: 'always',
    evidence: [{ file: 'apps/web/vercel.json', contains: '"framework": "nextjs"' }],
  },
  {
    id: 'supabase',
    vendor: 'Supabase Inc.',
    service: 'Supabase (PostgreSQL, Auth)',
    purpose: {
      es: 'Base de datos principal de la plataforma y autenticación de usuarios.',
      en: 'Primary platform database and user authentication.',
    },
    dataCategories: {
      es: 'Registros de la plataforma: perfiles y postulaciones de candidatos, datos de colaboradores y de RR. HH., resultados de evaluaciones, registros de consentimiento y de auditoría; credenciales de cuenta (correo electrónico, contraseña con hash, sesiones).',
      en: 'Platform records: candidate profiles and applications, employee and HR data, assessment results, consent and audit records; account credentials (email, hashed password, sessions).',
    },
    condition: 'always',
    evidence: [
      { file: 'packages/auth/package.json', contains: '@supabase/ssr' },
      { file: 'apps/web/lib/env.ts', contains: 'DATABASE_URL' },
    ],
  },
  {
    id: 'aws-bedrock',
    vendor: 'Amazon Web Services, Inc.',
    service: 'Amazon Bedrock',
    purpose: {
      es: 'Inferencia de modelos de IA para las funciones asistidas por IA (por ejemplo, análisis de CV, preselección de candidatos, redacción de vacantes).',
      en: 'AI model inference for AI-assisted features (for example CV parsing, candidate screening, vacancy writing).',
    },
    dataCategories: {
      es: 'Texto enviado en las solicitudes al modelo, que puede incluir contenido de CV y datos de perfil de candidatos o colaboradores; respuestas del modelo.',
      en: 'Text sent in model requests, which can include CV content and candidate or employee profile data; model responses.',
    },
    condition: 'always',
    // 'amazon-bedrock', not the factory name: tests/ai/door-gate.test.ts forbids that token outside packages/ai.
    evidence: [{ file: 'packages/ai/src/client.ts', contains: 'amazon-bedrock' }],
  },
  {
    id: 'aws-s3',
    vendor: 'Amazon Web Services, Inc.',
    service: 'Amazon S3',
    purpose: {
      es: 'Almacenamiento de los archivos de CV cargados en el formulario de postulación.',
      en: 'Storage of CV files uploaded through the application form.',
    },
    dataCategories: {
      es: 'Archivos de CV (pueden contener cualquier dato personal que el candidato incluya).',
      en: 'CV files (may contain any personal data the candidate includes).',
    },
    condition: 'configured',
    activatedBy: ['CV_UPLOADS_BUCKET', 'CV_UPLOADS_REGION'],
    evidence: [
      { file: 'packages/api/package.json', contains: '@aws-sdk/client-s3' },
      { file: 'apps/web/lib/env.ts', contains: 'CV_UPLOADS_BUCKET' },
    ],
  },
  {
    id: 'aws-ses',
    vendor: 'Amazon Web Services, Inc.',
    service: 'Amazon SES',
    purpose: {
      es: 'Envío de correos electrónicos transaccionales (invitaciones, enlaces de entrevista, notificaciones).',
      en: 'Delivery of transactional email (invitations, interview links, notifications).',
    },
    dataCategories: {
      es: 'Dirección de correo y nombre del destinatario; contenido del mensaje.',
      en: 'Recipient email address and name; message content.',
    },
    condition: 'always',
    evidence: [
      { file: 'packages/api/package.json', contains: '@aws-sdk/client-ses' },
      {
        file: 'services/Tims.Platform/src/Tims.Infrastructure/Email/SesEmailSender.cs',
        contains: 'AmazonSimpleEmailService',
      },
    ],
  },
  {
    id: 'aws-app-runner',
    vendor: 'Amazon Web Services, Inc.',
    service: 'AWS App Runner, Amazon CloudWatch',
    purpose: {
      es: 'Alojamiento del servicio de API de la plataforma y de sus registros operativos.',
      en: 'Hosting of the platform API service and its operational logs.',
    },
    dataCategories: {
      es: 'Datos de la plataforma procesados por la API, en tránsito; metadatos de solicitudes; registros de aplicación.',
      en: 'Platform data processed by the API, in transit; request metadata; application logs.',
    },
    condition: 'always',
    evidence: [{ file: 'services/Tims.Platform/deploy/terraform/main.tf', contains: 'aws_apprunner_service' }],
  },
  {
    id: 'daily',
    vendor: 'Daily.co',
    service: 'Daily',
    purpose: {
      es: 'Videollamadas para entrevistas en vivo.',
      en: 'Video calls for live interviews.',
    },
    dataCategories: {
      es: 'Audio y video de los participantes en tiempo real; nombres visibles; metadatos de la sala.',
      en: "Participants' real-time audio and video; display names; room metadata.",
    },
    condition: 'configured',
    activatedBy: ['DAILY_API_KEY'],
    evidence: [
      { file: 'packages/api/src/services/video.service.ts', contains: 'DAILY_API_KEY' },
      { file: 'package.json', contains: '@daily-co/daily-react' },
    ],
  },
  {
    id: 'elevenlabs',
    vendor: 'ElevenLabs Inc.',
    service: 'ElevenLabs Conversational AI',
    purpose: {
      es: 'Entrevistas por voz conducidas por un agente de IA.',
      en: 'Voice interviews conducted by an AI agent.',
    },
    dataCategories: {
      es: 'Audio de voz del candidato; transcripciones de la conversación; preguntas de la guía de entrevista.',
      en: "Candidate's voice audio; conversation transcripts; interview guide questions.",
    },
    condition: 'configured',
    activatedBy: ['ELEVENLABS_API_KEY'],
    evidence: [
      { file: 'packages/api/src/integrations/elevenlabs.ts', contains: 'ELEVENLABS_API_KEY' },
      { file: 'apps/web/package.json', contains: '@elevenlabs/react' },
    ],
  },
  {
    id: 'sentry',
    vendor: 'Sentry',
    service: 'Sentry',
    purpose: {
      es: 'Monitoreo de errores de la aplicación web.',
      en: 'Error monitoring for the web application.',
    },
    dataCategories: {
      es: 'Reportes de error (mensaje de error, traza, URL de la solicitud, navegador y dispositivo). Los errores del servidor incluyen además los identificadores internos del usuario que inició sesión y de su organización. El envío de PII por defecto está desactivado y los tokens de enlace para unirse a entrevistas se eliminan antes del envío.',
      en: 'Error reports (error message, stack trace, request URL, browser and device). Server errors also carry the internal identifiers of the signed-in user and of their organization. Default PII sending is disabled and interview-join link tokens are scrubbed before sending.',
    },
    condition: 'configured',
    activatedBy: ['NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_DSN'],
    evidence: [
      { file: 'apps/web/instrumentation-client.ts', contains: 'sendDefaultPii: false' },
      { file: 'apps/web/lib/sentry-redact.ts', contains: 'JOIN_TOKEN_PATH' },
      { file: 'apps/web/app/api/trpc/[trpc]/route.ts', contains: 'extra: base' },
      { file: 'apps/web/package.json', contains: '@sentry/nextjs' },
    ],
  },
  {
    id: 'cloudflare-turnstile',
    vendor: 'Cloudflare, Inc.',
    service: 'Cloudflare Turnstile',
    purpose: {
      es: 'Protección contra bots en el formulario público de postulación.',
      en: 'Bot protection on the public application form.',
    },
    dataCategories: {
      es: 'Dirección IP y señales del navegador y del dispositivo recopiladas por el desafío; token del desafío.',
      en: 'IP address and browser/device signals collected by the challenge; challenge token.',
    },
    condition: 'configured',
    activatedBy: ['NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'],
    evidence: [{ file: 'packages/api/src/routers/portal.ts', contains: 'TURNSTILE_SECRET_KEY' }],
  },
  {
    id: 'upstash',
    vendor: 'Upstash, Inc.',
    service: 'Upstash Redis',
    purpose: {
      es: 'Limitación de tasa de solicitudes y caché.',
      en: 'Request rate limiting and caching.',
    },
    dataCategories: {
      es: 'Claves de limitación (direcciones IP, identificadores de usuario y de organización, hash de direcciones de correo); valores en caché (verificaciones de permisos y respuestas de IA de los agentes configurados con caché).',
      en: 'Rate-limit keys (IP addresses, user and organization identifiers, hashed email addresses); cached values (permission checks and AI responses for agents configured with a cache TTL).',
    },
    condition: 'configured',
    activatedBy: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    evidence: [
      { file: 'packages/api/src/middleware/rate-limit.ts', contains: '@upstash/ratelimit' },
      { file: 'packages/ai/src/cache.ts', contains: 'cacheTtlSeconds' },
    ],
  },
  {
    id: 'stripe',
    vendor: 'Stripe, Inc.',
    service: 'Stripe Billing',
    purpose: {
      es: 'Facturación de suscripciones de las organizaciones cliente.',
      en: 'Subscription billing for customer organizations.',
    },
    dataCategories: {
      es: 'Nombre de la organización; correo de facturación; datos de suscripción y de pago (los datos de tarjeta se ingresan en páginas alojadas por Stripe).',
      en: 'Organization name; billing email; subscription and payment data (card details are entered on Stripe-hosted pages).',
    },
    condition: 'configured',
    activatedBy: ['STRIPE_SECRET_KEY'],
    evidence: [
      { file: 'packages/api/src/services/billing.service.ts', contains: 'checkout.sessions.create' },
      { file: 'packages/api/package.json', contains: '"stripe"' },
    ],
  },
  {
    id: 'bamboohr',
    vendor: 'Bamboo HR LLC',
    service: 'BambooHR',
    purpose: {
      es: 'Sincronización con el sistema de RR. HH. de la organización cliente, cuando esta la habilita.',
      en: "Sync with the customer organization's HR system, when the customer enables it.",
    },
    dataCategories: {
      es: 'Directorio de colaboradores leído de la cuenta de BambooHR del cliente.',
      en: "Employee directory read from the customer's BambooHR account.",
    },
    condition: 'customer-enabled',
    evidence: [
      { file: 'services/Tims.Platform/src/Tims.Infrastructure/Hris/HrisOptions.cs', contains: 'api.bamboohr.com' },
    ],
  },
];
