export const auditLogSelect = {
  id: true,
  action: true,
  entity: true,
  entityId: true,
  userId: true,
  metadata: true,
  createdAt: true,
  ipAddress: true,
  actor: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
} as const;

export const SYSTEM_FLAG_KEYS = [
  'ai_enabled',
  'nine_box_enabled',
  'dei_enabled',
  'compensation_enabled',
  'succession_enabled',
  'video_interviews',
  'whatsapp_enabled',
  'advanced_analytics',
  'api_access',
  'sso_saml',
];

export type HealthStatus = 'operational' | 'degraded' | 'down' | 'unmonitored';

export interface HealthService {
  name: string;
  status: HealthStatus;
  metrics: { label: string; value: string; color?: 'green' | 'amber' | 'red' }[];
}

interface SystemHealthInputs {
  dbHealthy: boolean;
  dbLatency: number;
  orgCount: number;
  userCount: number;
  vacancyCount: number;
  loginsToday: number;
  failedLogins: number;
  enabledUsers: number;
}

/** Only a successful live DB query establishes a service's operational state. */
export function buildSystemHealthServices({
  dbHealthy,
  dbLatency,
  userCount,
  vacancyCount,
  orgCount,
  loginsToday,
  failedLogins,
  enabledUsers,
}: SystemHealthInputs): HealthService[] {
  return [
    {
      name: 'API Gateway',
      status: 'unmonitored',
      metrics: [
        { label: 'Latencia API', value: 'N/D' },
        { label: 'Disponibilidad', value: 'N/D' },
        { label: 'Requests/min', value: 'N/D' },
      ],
    },
    {
      name: 'Base de Datos',
      status: dbHealthy ? 'operational' : 'down',
      metrics: [
        { label: 'Conectividad', value: dbHealthy ? 'OK' : 'Sin respuesta' },
        {
          label: 'Query time',
          value: dbHealthy ? `${dbLatency}ms` : 'N/D',
          color: dbHealthy ? (dbLatency < 50 ? 'green' : 'amber') : 'red',
        },
        { label: 'Usuarios / orgs / vacantes', value: `${userCount} / ${orgCount} / ${vacancyCount}` },
      ],
    },
    {
      name: 'Autenticacion',
      status: 'unmonitored',
      metrics: [
        { label: 'Usuarios con ingreso hoy', value: String(loginsToday) },
        { label: 'Fallos auditados hoy', value: String(failedLogins), color: failedLogins > 0 ? 'red' : undefined },
        { label: 'Usuarios habilitados', value: String(enabledUsers) },
      ],
    },
    {
      name: 'Almacenamiento',
      status: 'unmonitored',
      metrics: [
        { label: 'Usado', value: 'N/D' },
        { label: 'Uploads hoy', value: 'N/D' },
      ],
    },
    {
      name: 'Background Jobs',
      status: 'unmonitored',
      metrics: [
        { label: 'Cola', value: 'N/D' },
        { label: 'Fallidos', value: 'N/D' },
        { label: 'Procesados hoy', value: 'N/D' },
      ],
    },
    {
      name: 'AI (Bedrock)',
      status: 'unmonitored',
      metrics: [
        { label: 'Llamadas hoy', value: 'N/D' },
        { label: 'Costo', value: 'N/D' },
        { label: 'Presupuesto', value: 'N/D' },
      ],
    },
    {
      name: 'Email (SES)',
      status: 'unmonitored',
      metrics: [
        { label: 'Enviados hoy', value: 'N/D' },
        { label: 'Bounce rate', value: 'N/D' },
        { label: 'Reputation', value: 'N/D' },
      ],
    },
    {
      name: 'Realtime',
      status: 'unmonitored',
      metrics: [
        { label: 'Conexiones', value: 'N/D' },
        { label: 'Mensajes/seg', value: 'N/D' },
        { label: 'Canales activos', value: 'N/D' },
      ],
    },
  ];
}

export function getOverallHealthStatus(services: HealthService[]): HealthStatus {
  if (services.some((service) => service.status === 'down')) return 'down';
  if (services.some((service) => service.status === 'degraded')) return 'degraded';
  if (services.length === 0 || services.some((service) => service.status === 'unmonitored')) return 'unmonitored';
  return 'operational';
}
