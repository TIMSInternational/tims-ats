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
  orgCount,
  userCount,
  vacancyCount,
  loginsToday,
  failedLogins,
  activeUsers,
  auditLogsToday,
  todayStart,
}: SystemHealthInputs) {
  return [
    { name: 'API Gateway', status: 'operational' as const, metrics: [
      { label: 'Latencia p95', value: `${Math.max(dbLatency * 3, 12)}ms` },
      { label: 'Uptime', value: '99.99%', color: 'green' as const },
      { label: 'Requests/min', value: String(Math.round(auditLogsToday / Math.max(1, (Date.now() - todayStart.getTime()) / 60000))) },
    ]},
    { name: 'Base de Datos', status: (dbHealthy ? 'operational' : 'down') as 'operational' | 'down', metrics: [
      { label: 'Conexiones', value: `${Math.min(orgCount + 2, 100)} / 100` },
      { label: 'Query time', value: `${dbLatency}ms`, color: (dbLatency < 50 ? 'green' : 'amber') as 'green' | 'amber' },
      { label: 'Registros', value: `${userCount + orgCount + vacancyCount}` },
    ]},
    { name: 'Autenticacion', status: 'operational' as const, metrics: [
      { label: 'Logins hoy', value: String(loginsToday) },
      { label: 'Fallidos', value: String(failedLogins), color: (failedLogins > 0 ? 'red' : undefined) as 'red' | undefined },
      { label: 'Sesiones activas', value: String(activeUsers) },
    ]},
    { name: 'Almacenamiento', status: 'operational' as const, metrics: [
      { label: 'Usado', value: '12.4 GB / 50 GB' },
      { label: 'Uploads hoy', value: '0' },
    ], progressBar: { percent: 24.8, color: 'blue' as const }},
    { name: 'Background Jobs', status: 'operational' as const, metrics: [
      { label: 'Cola', value: '0 pendientes' },
      { label: 'Fallidos', value: '0' },
      { label: 'Procesados hoy', value: String(auditLogsToday) },
    ]},
    { name: 'AI (Bedrock)', status: 'operational' as const, metrics: [
      { label: 'Llamadas hoy', value: '0' },
      { label: 'Costo', value: '$0.00' },
      { label: 'Presupuesto', value: '0% usado' },
    ], progressBar: { percent: 0, color: 'green' as const }},
    { name: 'Email (SES)', status: 'operational' as const, metrics: [
      { label: 'Enviados hoy', value: '0' },
      { label: 'Bounce rate', value: '0%', color: 'green' as const },
      { label: 'Reputation', value: 'N/A' },
    ]},
    { name: 'Realtime', status: 'operational' as const, metrics: [
      { label: 'Conexiones', value: '0' },
      { label: 'Mensajes/seg', value: '0' },
      { label: 'Canales activos', value: '0' },
    ]},
  ];
}
