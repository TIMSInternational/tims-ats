import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeAvgProgress } from '../../packages/api/src/routers/learning-progress';

describe('mergeAvgProgress', () => {
  it('attaches rounded avg progress per course, 0 when absent', () => {
    const courses = [{ id: 'c1' }, { id: 'c2' }] as { id: string }[];
    const rows = [{ courseId: 'c1', _avg: { progress: 47.6 } }];
    const out = mergeAvgProgress(courses, rows);
    expect(out.find((c) => c.id === 'c1')!.avgProgress).toBe(48);
    expect(out.find((c) => c.id === 'c2')!.avgProgress).toBe(0);
  });
});

describe('course-catalog.tsx frontend tripwire', () => {
  const cat = readFileSync(
    resolve(__dirname, '../../apps/web/app/(admin)/learning/course-catalog.tsx'),
    'utf8',
  );

  it('renders real avgProgress, not Math.random', () => {
    expect(cat).not.toMatch(/Math\.random/);
    expect(cat).toMatch(/course\.avgProgress/);
  });
});
