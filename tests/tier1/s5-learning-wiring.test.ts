import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('S5 learning enroll wiring', () => {
  const modal = read('apps/web/app/(admin)/learning/enroll-modal.tsx');
  const catalog = read('apps/web/app/(admin)/learning/course-catalog.tsx');
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));

  it('calls the real enrollUser mutation (not a comingSoon stub)', () => {
    expect(modal).toMatch(/trpc\.learning\.enrollUser\.useMutation/);
    expect(modal).not.toMatch(/comingSoon/);
  });

  it('invalidates listCourses on success', () => {
    expect(modal).toMatch(/utils\.learning\.listCourses\.invalidate/);
  });

  it('invalidates getDashboardKpis on success', () => {
    expect(modal).toMatch(/utils\.learning\.getDashboardKpis\.invalidate/);
  });

  it('renders inside the shared Modal component', () => {
    expect(modal).toMatch(/<Modal\b/);
    expect(modal).toMatch(/from '.*\/components'/);
  });

  it('passes userId from employee state and courseId from prop', () => {
    expect(modal).toMatch(/userId.*employee\.id|employee\.id.*userId/);
    expect(modal).toMatch(/courseId/);
  });

  it('uses UserPicker for employee selection', () => {
    expect(modal).toMatch(/UserPicker/);
  });

  it('has no inline style or any type', () => {
    expect(modal).not.toMatch(/style=\{\{/);
    expect(modal).not.toMatch(/:\s*any\b/);
    expect(modal).not.toMatch(/\bas any\b/);
  });

  it('course-catalog.tsx mounts EnrollModal', () => {
    expect(catalog).toMatch(/<EnrollModal\b/);
  });

  it('course-catalog.tsx no longer contains Math.random (fixed by Tier-2 Slice A)', () => {
    expect(catalog).not.toMatch(/Math\.random/);
  });

  it('i18n keys enrollTitle and enrollSuccess exist in BOTH locales', () => {
    expect(es.learning.enrollTitle, 'es.learning.enrollTitle').toBeTruthy();
    expect(en.learning.enrollTitle, 'en.learning.enrollTitle').toBeTruthy();
    expect(es.learning.enrollSuccess, 'es.learning.enrollSuccess').toBeTruthy();
    expect(en.learning.enrollSuccess, 'en.learning.enrollSuccess').toBeTruthy();
  });

  it('i18n keys enrollAction, courseLabel, employeeLabel exist in BOTH locales', () => {
    expect(es.learning.enrollAction, 'es.learning.enrollAction').toBeTruthy();
    expect(en.learning.enrollAction, 'en.learning.enrollAction').toBeTruthy();
    expect(es.learning.courseLabel, 'es.learning.courseLabel').toBeTruthy();
    expect(en.learning.courseLabel, 'en.learning.courseLabel').toBeTruthy();
    expect(es.learning.employeeLabel, 'es.learning.employeeLabel').toBeTruthy();
    expect(en.learning.employeeLabel, 'en.learning.employeeLabel').toBeTruthy();
  });
});
