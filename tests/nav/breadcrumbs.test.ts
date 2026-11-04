import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveBreadcrumb, type Crumb } from '../../apps/web/lib/nav/breadcrumbs';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

const esCrumbs = es.breadcrumbs as Record<string, Crumb>;
const enCrumbs = en.breadcrumbs as Record<string, Crumb>;

describe('resolveBreadcrumb', () => {
  const crumbs: Record<string, Crumb> = {
    '/recruitment': { label: 'Reclutamiento' },
    '/recruitment/vacancies': { parent: 'Reclutamiento', label: 'Vacantes' },
    '/recruitment/vacancies-archive': { parent: 'Reclutamiento', label: 'Archivo' },
  };

  it('prefers the exact path', () => {
    expect(resolveBreadcrumb('/recruitment/vacancies', crumbs)?.label).toBe('Vacantes');
  });

  it('falls back to the longest segment-aware prefix (detail pages inherit their list page)', () => {
    expect(resolveBreadcrumb('/recruitment/vacancies/123', crumbs)?.label).toBe('Vacantes');
    expect(resolveBreadcrumb('/recruitment/vacancies-archive/9', crumbs)?.label).toBe('Archivo');
    expect(resolveBreadcrumb('/recruitment/offers', crumbs)?.label).toBe('Reclutamiento');
  });

  it('does not match a sibling that only shares a string prefix', () => {
    expect(resolveBreadcrumb('/recruitmentx', crumbs)).toBeNull();
  });

  it('returns null (no crumb) instead of inventing one, and ignores prototype keys', () => {
    expect(resolveBreadcrumb('/somewhere', crumbs)).toBeNull();
    expect(resolveBreadcrumb('constructor', crumbs)).toBeNull();
  });
});

describe('pilot routes all get a real breadcrumb (no "TIMS Platform" fallback)', () => {
  // Every page an INVU staff role can reach in the pilot, including detail pages.
  const PILOT_ROUTES: Array<[string, string, string | undefined]> = [
    ['/dashboard', 'Inicio', undefined],
    ['/my-onboarding', 'Mi Onboarding', 'Mi Espacio'],
    ['/people/onboarding', 'Onboarding', 'Personas'],
    ['/recruitment/vacancies/7f0c', 'Vacantes', 'Reclutamiento'],
    ['/recruitment/candidates/7f0c', 'Candidatos', 'Reclutamiento'],
    ['/recruitment/interviews/7f0c/room', 'Entrevistas', 'Reclutamiento'],
    ['/recruitment/offers', 'Ofertas', 'Reclutamiento'],
    ['/settings/users', 'Equipo', 'Configuración'],
    ['/settings/business-units', 'Unidades de Negocio', 'Configuración'],
    ['/settings/branding', 'Marca', 'Configuración'],
    ['/settings/fit-weights', 'Pesos FIT', 'Configuración'],
    ['/settings/audit-log', 'Registro de Auditoría', 'Configuración'],
    ['/settings/data-requests', 'Solicitudes de titulares', 'Configuración'],
    ['/platform/organizations/7f0c', 'Organizaciones', 'Plataforma'],
  ];

  it.each(PILOT_ROUTES)('%s → %s', (path, label, parent) => {
    const crumb = resolveBreadcrumb(path, esCrumbs);
    expect(crumb?.label).toBe(label);
    expect(crumb?.parent).toBe(parent);
    expect(resolveBreadcrumb(path, enCrumbs)?.label).toBeTruthy();
  });

  it('the home page reads "Inicio", not "Dashboard"', () => {
    expect(resolveBreadcrumb('/dashboard', esCrumbs)?.label).toBe('Inicio');
  });

  it('the navbar no longer hard-codes the product name as a breadcrumb', () => {
    const src = readFileSync(resolve(__dirname, '../../apps/web/app/(admin)/navbar/index.tsx'), 'utf8');
    expect(src).not.toContain('TIMS Platform');
    expect(src).toContain('resolveBreadcrumb(');
  });
});
