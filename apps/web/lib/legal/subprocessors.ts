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
      es: 'Registros de la plataforma: perfiles y postulaciones de candidatos, datos de colaboradores y de RR. HH., resultados de evaluaciones, registros de consentimiento y de auditoría; credenciales de cuenta (correo electrónico; la contraseña, que Supabase recibe por HTTPS cada vez que se define o se usa para iniciar sesión y guarda solo como hash; sesiones).',
      en: 'Platform records: candidate profiles and applications, employee and HR data, assessment results, consent and audit records; account credentials (email; the password, which Supabase receives over HTTPS whenever it is set or used to sign in, and stores only as a hash; sessions).',
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
      es: 'Inferencia de modelos de IA para las funciones asistidas por IA (por ejemplo, análisis de CV, preselección y comparación de candidatos con la vacante, explicación de la puntuación FIT, guías y resúmenes de entrevistas, redacción de vacantes).',
      en: 'AI model inference for AI-assisted features (for example CV parsing, candidate screening and matching against the vacancy, FIT score explanations, interview guides and summaries, vacancy writing).',
    },
    dataCategories: {
      es: 'Texto enviado en las solicitudes al modelo, que puede incluir contenido de CV, datos de perfil de candidatos o colaboradores y el desglose de la puntuación FIT (incluidos los resultados de evaluaciones que la alimentan); respuestas del modelo.',
      en: 'Text sent in model requests, which can include CV content, candidate or employee profile data and the FIT score breakdown (including the assessment results that feed it); model responses.',
    },
    condition: 'always',
    // 'amazon-bedrock', not the factory name: tests/ai/door-gate.test.ts forbids that token outside packages/ai.
    evidence: [
      { file: 'packages/ai/src/client.ts', contains: 'amazon-bedrock' },
      { file: 'packages/ai/src/agents/cv-parser.ts', contains: 'cv-parser' },
      { file: 'packages/ai/src/agents/fit-explainer.ts', contains: 'assessments' },
    ],
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
      { file: 'packages/api/package.json', contains: '@aws-sdk/s3-request-presigner' },
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
    id: 'aws-dynamodb',
    vendor: 'Amazon Web Services, Inc.',
    service: 'Amazon DynamoDB',
    purpose: {
      es: 'Limitación de tasa de solicitudes compartida por la aplicación web y el servicio de API.',
      en: 'Request rate limiting shared by the web application and the API service.',
    },
    dataCategories: {
      es: 'Contadores de limitación con su clave: dirección IP, identificadores internos de usuario, de organización, de clave de API o de vacante, y el hash SHA-256 de la dirección de correo que recibe la confirmación de postulación.',
      en: 'Rate-limit counters and their keys: IP address, internal user, organization, API key or vacancy identifiers, and the SHA-256 hash of the email address that receives the application confirmation.',
    },
    condition: 'configured',
    activatedBy: ['RATE_LIMIT_DYNAMODB_TABLE', 'RATE_LIMIT_DYNAMODB_REGION'],
    evidence: [
      { file: 'packages/api/src/middleware/rate-limit-store.ts', contains: '@aws-sdk/client-dynamodb' },
      { file: 'packages/api/src/middleware/rate-limit.ts', contains: "createHash('sha256')" },
      {
        file: 'services/Tims.Platform/src/Tims.Infrastructure/RateLimiting/DynamoDbRateLimitStore.cs',
        contains: 'Amazon.DynamoDBv2',
      },
    ],
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
      es: 'Monitoreo de errores de la aplicación web y de la API de la plataforma.',
      en: 'Error monitoring for the web application and the platform API.',
    },
    dataCategories: {
      es: 'Reportes de error (mensaje de error, traza, URL de la solicitud, navegador y dispositivo). Los errores del servidor incluyen además los identificadores internos del usuario que inició sesión y de su organización. El envío de PII por defecto está desactivado, y antes del envío se eliminan las credenciales que viajan en enlaces: los tokens de enlace para firmar ofertas, para unirse a entrevistas y de entrevistas con IA, y los códigos de invitación, de restablecimiento de contraseña y de inicio de sesión.',
      en: 'Error reports (error message, stack trace, request URL, browser and device). Server errors also carry the internal identifiers of the signed-in user and of their organization. Default PII sending is disabled, and credentials carried in links are scrubbed before sending: offer-signing, interview-join and AI-interview link tokens, and invitation, password-reset and sign-in codes.',
    },
    condition: 'configured',
    activatedBy: ['NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_DSN', 'Sentry__Dsn'],
    evidence: [
      { file: 'apps/web/instrumentation-client.ts', contains: 'sendDefaultPii: false' },
      { file: 'apps/web/lib/sentry-redact.ts', contains: 'export function redactSentryEvent' },
      { file: 'apps/web/sentry.server.config.ts', contains: 'beforeSend: (event) => redactSentryEvent(event)' },
      { file: 'apps/web/app/api/trpc/[trpc]/route.ts', contains: 'extra: base' },
      { file: 'apps/web/package.json', contains: '@sentry/nextjs' },
      { file: 'services/Tims.Platform/src/Tims.Api/ErrorReporting/ErrorReportingExtensions.cs', contains: 'options.SendDefaultPii = false;' },
      { file: 'services/Tims.Platform/src/Tims.Api/Tims.Api.csproj', contains: 'Sentry.AspNetCore' },
    ],
  },
  {
    id: 'vercel-web-analytics',
    vendor: 'Vercel Inc.',
    service: 'Vercel Web Analytics',
    purpose: {
      es: 'Medición de visitas sin cookies y de los pasos del proceso de postulación en los portales de empleo.',
      en: 'Cookieless measurement of visits and of the application steps on the careers portals.',
    },
    dataCategories: {
      es: 'Páginas visitadas (origen y ruta, sin parámetros ni fragmentos y con los identificadores reemplazados), página de referencia, navegador, dispositivo y país aproximado; eventos del proceso de postulación con el identificador público del portal de la organización. No se envían páginas cuyo enlace es una credencial, ni datos de candidatos, correos o identificadores.',
      en: 'Pages visited (origin and path, without query strings or fragments and with identifiers replaced), referring page, browser, device and approximate country; application-step events carrying the organization\'s public careers slug. Pages whose link is a credential, candidate data, emails and identifiers are never sent.',
    },
    condition: 'configured',
    activatedBy: ['NEXT_PUBLIC_WEB_ANALYTICS_ENABLED'],
    evidence: [
      { file: 'apps/web/package.json', contains: '@vercel/analytics' },
      { file: 'apps/web/lib/analytics/web-analytics.ts', contains: 'export function scrubAnalyticsEvent' },
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
      es: 'Registro temporal de identificadores de un solo uso del servicio de API durante la transición de su almacén de limitación de tasa, y cachés opcionales que solo se usan si se activan expresamente.',
      en: "Temporary register of the API service's single-use request identifiers while its rate-limit store transitions, and optional caches used only when explicitly enabled.",
    },
    dataCategories: {
      es: 'Identificadores aleatorios de un solo uso (sin datos personales). Solo si se activan las cachés: resultados de verificaciones de permisos y respuestas de IA de los agentes configurados con caché.',
      en: 'Random single-use identifiers (no personal data). Only when the caches are enabled: permission-check results and AI responses for agents configured with a cache TTL.',
    },
    condition: 'configured',
    activatedBy: ['RedisConnectionString', 'AI_CACHE_UPSTASH_ENABLED', 'PERMISSION_CACHE_UPSTASH_ENABLED'],
    evidence: [
      { file: 'services/Tims.Platform/src/Tims.Api/Http/LegacyRelayNonceBridge.cs', contains: 'tims:relay:nonce:' },
      { file: 'packages/ai/src/cache.ts', contains: "process.env.AI_CACHE_UPSTASH_ENABLED === 'true'" },
      { file: 'packages/api/src/lib/cache.ts', contains: 'PERMISSION_CACHE_UPSTASH_ENABLED' },
    ],
  },
  {
    id: 'tims-assessments',
    vendor: 'TIMS International',
    service: 'TIMS Assessments (timssuite.com)',
    purpose: {
      es: 'Aplicación y calificación de las evaluaciones que la organización asigna a un candidato (por ejemplo LIA, Personalidad TIMS, Inglés y PCA); sus resultados alimentan la puntuación FIT.',
      en: 'Delivery and scoring of the assessments the organization assigns to a candidate (for example LIA, TIMS Personality, English and PCA); their results feed the FIT score.',
    },
    dataCategories: {
      es: 'Nombre de la organización; nombre, apellidos, correo electrónico e idioma preferido del candidato y una referencia interna; la vacante a la que se vincula la evaluación y la razón por la que se relaciona con el puesto; ajustes de tiempo o de accesibilidad y una declaración de rango de edad; la configuración de supervisión de la prueba; los consentimientos del candidato para las evaluaciones; respuestas y resultados de las evaluaciones. Recopilados por el servicio directamente en el navegador del candidato mientras la prueba se ejecuta en su reproductor: alertas de seguridad registradas durante la prueba (por ejemplo, cambiar de pestaña, salir de la ventana o conectar otra pantalla); con el consentimiento opcional de voz del candidato, la grabación de voz de la sección oral de inglés; y, solo si se activa la verificación de identidad para las pruebas de la organización, fotos del candidato tomadas con la cámara al empezar y periódicamente durante la prueba para verificar su identidad (datos biométricos).',
      en: "Organization name; the candidate's given and family name, email address, preferred language and an internal reference; the vacancy the assessment is linked to and why it relates to the position; time or accessibility accommodations and an age-band attestation; the test's proctoring settings; the candidate's assessment consents; assessment answers and results. Collected by the service directly in the candidate's browser while the test runs in its player: security alerts recorded during the test (for example switching tabs, leaving the window or connecting another screen); with the candidate's optional voice consent, the voice recording of the English speaking section; and, only if the identity check is turned on for the organization's tests, photos of the candidate taken with the camera at the start and periodically during the test to verify their identity (biometric data).",
    },
    condition: 'customer-enabled',
    evidence: [
      {
        file: 'services/Tims.Platform/src/Tims.Infrastructure/Assessments/Providers/TimsAssessmentsClient.cs',
        contains: 'AddIfPresent(body, "email", request.Email)',
      },
      {
        file: 'services/Tims.Platform/src/Tims.Infrastructure/Assessments/Providers/TimsAssessmentsClient.cs',
        contains: '["display_name"] = request.DisplayName',
      },
      { file: 'services/Tims.Platform/src/Tims.Api/Program.cs', contains: 'var providerResultsFeedFit' },
      {
        file: 'services/Tims.Platform/src/Tims.Domain/Assessments/Providers/ProviderVocabulary.cs',
        contains: 'public const string Voice = "voice";',
      },
      {
        file: 'services/Tims.Platform/src/Tims.Domain/Assessments/Providers/ProviderProctoring.cs',
        contains: '(camera face checks; requires the <c>biometric</c> consent and the hosted player)',
      },
      {
        file: 'apps/web/app/(portal)/careers/[orgSlug]/dashboard/provider-assessment-frame.tsx',
        contains: "'camera; microphone; fullscreen; autoplay'",
      },
    ],
  },
  {
    id: 'tims-pca',
    vendor: 'TIMS International',
    service: 'PCA (timshr.com)',
    purpose: {
      es: 'Cuestionario PCA (Análisis de Competencias Personales), que el candidato responde en el sitio de TIMS International cuando la organización se lo asigna.',
      en: "The PCA questionnaire (Personal Competencies Analysis), which the candidate answers on TIMS International's site when the organization assigns it.",
    },
    dataCategories: {
      es: 'Las respuestas del candidato al cuestionario, ingresadas directamente en ese sitio; metadatos de las solicitudes del navegador (dirección IP, agente de usuario).',
      en: "The candidate's questionnaire answers, entered directly on that site; browser request metadata (IP address, user agent).",
    },
    condition: 'customer-enabled',
    evidence: [
      {
        file: 'apps/web/lib/security/csp.ts',
        contains: "DEFAULT_ASSESSMENT_PROVIDER_FRAME_ORIGIN = 'https://timshr.com'",
      },
      { file: 'apps/web/lib/assessment-player-launch.ts', contains: "launch.delivery === 'link_out'" },
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
