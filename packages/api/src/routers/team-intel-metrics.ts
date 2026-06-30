export function computeAvgTenureYears(members: { createdAt: Date }[], nowMs: number): number {
  if (members.length === 0) return 0;
  const years =
    members.reduce((s, m) => s + (nowMs - m.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 365), 0) /
    members.length;
  return Math.round(years * 10) / 10;
}

export function computeRoleDiversity(members: { jobTitle: string | null }[]): number {
  if (members.length === 0) return 0;
  const unique = new Set(members.map((m) => m.jobTitle).filter(Boolean)).size;
  return Math.round((unique / members.length) * 100) / 100;
}
