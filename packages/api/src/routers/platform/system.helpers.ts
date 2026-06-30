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
  'ai_enabled', 'nine_box_enabled', 'dei_enabled', 'compensation_enabled',
  'succession_enabled', 'video_interviews', 'whatsapp_enabled',
  'advanced_analytics', 'api_access', 'sso_saml',
];

interface SystemHealthInputs {
  dbHealthy: boolean;
  dbLatency: number;
  orgCount: number;
  userCount: number;
  vacancyCount: number;
  loginsToday: number;
  failedLogins: number;
  activeUsers: number;
  auditLogsToday: number;
  todayStart: Date;
}

export function buildSystemHealthServices({
  dbHealthy,
  dbLatency,
  userCount,
  vacancyCount,
  orgCount,
  loginsToday,
  failedLogins,
  activeUsers,
  auditLogsToday,
  todayStart,
}: SystemHealthInputs) {
  return [
    { name: 'API Gateway', status: 'operational' as const, metrics: [
      { label: 'Latencia', value: `${dbLatency}ms` },
      { label: 'Uptime', value: 'N/D' },
      { label: 'Requests/min', value: String(Math.round(auditLogsToday / Math.max(1, (Date.now() - todayStart.getTime()) / 60000))) },
    ]},
    { name: 'Base de Datos', status: (dbHealthy ? 'operational' : 'down') as 'operational' | 'down', metrics: [
      { label: 'Conexiones', value: 'N/D' },
      { label: 'Query time', value: `${dbLatency}ms`, color: (dbLatency < 50 ? 'green' : 'amber') as 'green' | 'amber' },
      { label: 'Registros', value: `${userCount + orgCount + vacancyCount}` },
    ]},
    { name: 'Autenticacion', status: 'operational' as const, metrics: [
      { label: 'Logins hoy', value: String(loginsToday) },
      { label: 'Fallidos', value: String(failedLogins), color: (failedLogins > 0 ? 'red' : undefined) as 'red' | undefined },
      { label: 'Sesiones activas', value: String(activeUsers) },
    ]},
    { name: 'Almacenamiento', status: 'operational' as const, metrics: [
      { label: 'Usado', value: 'N/D' },
      { label: 'Uploads hoy', value: 'N/D' },
    ]},
    { name: 'Background Jobs', status: 'operational' as const, metrics: [
      { label: 'Cola', value: 'N/D' },
      { label: 'Fallidos', value: 'N/D' },
      { label: 'Procesados hoy', value: String(auditLogsToday) },
    ]},
    { name: 'AI (Bedrock)', status: 'operational' as const, metrics: [
      { label: 'Llamadas hoy', value: 'N/D' },
      { label: 'Costo', value: 'N/D' },
      { label: 'Presupuesto', value: 'N/D' },
    ]},
    { name: 'Email (SES)', status: 'operational' as const, metrics: [
      { label: 'Enviados hoy', value: 'N/D' },
      { label: 'Bounce rate', value: 'N/D' },
      { label: 'Reputation', value: 'N/D' },
    ]},
    { name: 'Realtime', status: 'operational' as const, metrics: [
      { label: 'Conexiones', value: 'N/D' },
      { label: 'Mensajes/seg', value: 'N/D' },
      { label: 'Canales activos', value: 'N/D' },
    ]},
  ];
}
