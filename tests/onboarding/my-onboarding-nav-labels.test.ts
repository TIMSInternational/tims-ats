import { describe, expect, it } from 'vitest';
import { MANIFESTS, manifestFor } from '../../apps/web/lib/nav/manifest';
import { moduleForPath } from '../../apps/web/lib/nav/routes';
import {
  onboardingCheckInTypeLabel,
  onboardingOwnerLabel,
  onboardingPhaseLabel,
  onboardingStatusLabel,
} from '../../apps/web/lib/onboarding-labels';
import { ONBOARDING_TASK_OWNERS } from '../../packages/api/src/services/onboarding-defaults';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

function hrefsFor(roles: string[]): string[] {
  return manifestFor(roles).sections.flatMap((section) => section.items.map((item) => item.href));
}

describe('Mi Onboarding navigation', () => {
  it('routes the employee to the personal page, not the HR dashboard', () => {
    const item = MANIFESTS.employee.sections
      .flatMap((section) => section.items)
      .find((navItem) => navItem.labelKey === 'sidebar.myOnboarding');
    expect(item?.href).toBe('/my-onboarding');
    expect(hrefsFor(['employee'])).not.toContain('/people/onboarding');
  });

  it('keeps the HR dashboard for HR roles', () => {
    for (const role of ['super_admin', 'hr_admin', 'hrbp', 'leader']) {
      expect(hrefsFor([role])).toContain('/people/onboarding');
      expect(hrefsFor([role])).not.toContain('/my-onboarding');
    }
  });

  it('gates the personal page on the onboarding module (employee has read@own)', () => {
    expect(moduleForPath('/my-onboarding')).toBe('onboarding');
  });
});

describe('onboarding enum labels', () => {
  const locales = [
    ['es', es.myOnboarding.labels],
    ['en', en.myOnboarding.labels],
  ] as const;

  it.each(locales)('%s translates every raw phase, check-in and status slug', (_locale, labels) => {
    for (const phase of ['day1_30', 'day31_60', 'day61_90']) {
      expect(onboardingPhaseLabel(labels, phase)).not.toBe(phase);
    }
    for (const type of ['day1', 'day30', 'day60']) {
      expect(onboardingCheckInTypeLabel(labels, type)).not.toBe(type);
    }
    for (const status of ['pending', 'completed', 'active', 'cancelled']) {
      expect(onboardingStatusLabel(labels, status)).not.toBe(status);
    }
  });

  it.each(locales)('%s labels every default-template owner role', (_locale, labels) => {
    for (const owner of ONBOARDING_TASK_OWNERS) {
      expect(onboardingOwnerLabel(labels, owner)).not.toBe(owner);
    }
  });

  it('maps concrete Spanish labels and passes free-text owners through unchanged', () => {
    const labels = es.myOnboarding.labels;
    expect(onboardingCheckInTypeLabel(labels, 'day1')).toBe('Día 1');
    expect(onboardingStatusLabel(labels, 'pending')).toBe('Pendiente');
    expect(onboardingPhaseLabel(labels, 'day1_30')).toBe('Día 1-30');
    expect(onboardingOwnerLabel(labels, 'Equipo de TI')).toBe('Equipo de TI');
    expect(onboardingOwnerLabel(labels, 'toString')).toBe('toString');
  });
});
