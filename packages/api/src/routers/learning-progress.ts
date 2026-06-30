export interface ProgressRow {
  courseId: string;
  _avg: { progress: number | null };
}

export function mergeAvgProgress<T extends { id: string }>(
  courses: T[],
  rows: ProgressRow[],
): (T & { avgProgress: number })[] {
  const byCourse = new Map(rows.map((r) => [r.courseId, Math.round(r._avg.progress ?? 0)]));
  return courses.map((c) => ({ ...c, avgProgress: byCourse.get(c.id) ?? 0 }));
}
