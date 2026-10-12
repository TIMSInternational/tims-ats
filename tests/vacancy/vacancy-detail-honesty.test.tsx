import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { GeneralInfo } from '../../apps/web/app/(admin)/recruitment/vacancies/[id]/general-info';
import { Step3Compensation } from '../../apps/web/app/(admin)/recruitment/vacancies/create-modal.fields';
import type { VacancyDetail } from '../../apps/web/lib/trpc-types';

// #311: the staff vacancy detail rendered raw markdown, invented "/ mes" for salaries with no stored period,
// and the create modal's summary was hardcoded Spanish.

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function vacancy(overrides: Partial<Record<string, unknown>> = {}): VacancyDetail {
  return {
    title: 'Analista de datos',
    company: { name: 'Acme' },
    unit: null,
    location: 'Bogotá',
    remotePolicy: 'hybrid',
    contractType: 'termino_fijo',
    salary: { min: 4_500_000, max: 6_000_000, currency: 'COP', period: 'monthly' },
    assignee: null,
    priority: 'medium',
    createdAt: new Date('2026-09-01T12:00:00Z'),
    positions: 3,
    description: '## Responsabilidades\n\n- Liderar el **equipo**\n- Reportar',
    ...overrides,
  } as unknown as VacancyDetail;
}

async function renderIn(locale: 'ES' | 'EN', ui: React.ReactElement) {
  localStorage.setItem('tims-locale', locale);
  const view = render(<I18nProvider>{ui}</I18nProvider>);
  if (locale === 'EN') await waitFor(() => expect(view.container.textContent).not.toContain('Información'));
  return view;
}

describe('staff vacancy detail (#311)', () => {
  it('renders the description as safe markdown, not literal ** / ## / -', async () => {
    const { container } = await renderIn('ES', <GeneralInfo vacancy={vacancy()} />);
    expect(container.querySelector('h4')?.textContent).toBe('Responsabilidades');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('strong')?.textContent).toBe('equipo');
    expect(container.textContent).not.toContain('**');
    expect(container.textContent).not.toContain('##');
  });

  it('renders markup inside the description as text, never as HTML', async () => {
    const { container } = await renderIn(
      'ES',
      <GeneralInfo vacancy={vacancy({ description: '<img src=x onerror=alert(1)> hola' })} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)> hola');
  });

  it('shows currency + the stored period, and no period at all when none is stored', async () => {
    const { container, unmount } = await renderIn('ES', <GeneralInfo vacancy={vacancy()} />);
    expect(container.textContent).toContain('COP 4.500.000 – 6.000.000 / mes');
    unmount();

    const annual = await renderIn(
      'ES',
      <GeneralInfo
        vacancy={vacancy({ salary: { min: 60_000_000, max: 80_000_000, currency: 'COP', period: 'annual' } })}
      />,
    );
    expect(annual.container.textContent).toContain('COP 60.000.000 – 80.000.000 / año');
    annual.unmount();

    // Seed-demo vacancies store no period: previously shown as "/ Mensual".
    const none = await renderIn(
      'ES',
      <GeneralInfo vacancy={vacancy({ salary: { min: 4_500_000, max: 6_000_000, currency: 'COP' } })} />,
    );
    expect(none.container.textContent).toContain('COP 4.500.000 – 6.000.000');
    expect(none.container.textContent).not.toMatch(/\/ (mes|año)|Mensual|Anual/);
  });

  it('localizes the work mode, contract type and position count (English)', async () => {
    const { container } = await renderIn('EN', <GeneralInfo vacancy={vacancy()} />);
    expect(container.textContent).toContain('Bogotá (Hybrid)');
    expect(container.textContent).toContain('Fixed term');
    expect(container.textContent).toContain('3 positions');
    expect(container.textContent).toContain('COP 4,500,000 – 6,000,000 / month');
    expect(container.textContent).not.toMatch(/Hibrido|vacantes/);
  });
});

describe('create-vacancy summary (#311)', () => {
  const noop = () => {};
  const step3 = (
    <Step3Compensation
      salaryMin="8000000"
      setSalaryMin={noop}
      salaryMax="14000000"
      setSalaryMax={noop}
      currency="COP"
      setCurrency={noop}
      salaryPeriod="yearly"
      setSalaryPeriod={noop}
      slaTargetDays="30"
      setSlaTargetDays={noop}
      autoPublish={false}
      setAutoPublish={noop}
      requireApproval={false}
      setRequireApproval={noop}
      title="Data analyst"
      location="Medellín"
      remotePolicy="onsite"
      contractType="indefinido"
      positions={1}
    />
  );

  it('renders the summary and salary preview in English with no leftover Spanish', async () => {
    const { container } = await renderIn('EN', step3);
    const text = container.textContent ?? '';
    for (const expected of [
      'Summary',
      'Role:',
      'Contract:',
      'Salary:',
      'Permanent · 1 position',
      'Medellín (On-site)',
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).toContain('COP 8,000,000 – 14,000,000 / year');
    expect(text).not.toMatch(/Resumen|Cargo:|Contrato:|posición|Presencial|Mensual|Anual|Minimo|Maximo|Moneda|Periodo/);
  });

  it('renders the same summary in Spanish', async () => {
    const { container } = await renderIn('ES', step3);
    const text = container.textContent ?? '';
    for (const expected of ['Resumen', 'Cargo:', 'Contrato:', 'Salario:', 'Término indefinido · 1 posición']) {
      expect(text).toContain(expected);
    }
    expect(text).toContain('COP 8.000.000 – 14.000.000 / año');
  });

  it('keeps one source of truth for contract-type labels (portal.contractTypes)', () => {
    const helpers = readFileSync(
      join(__dirname, '../../apps/web/app/(admin)/recruitment/vacancies/create-modal.helpers.ts'),
      'utf8',
    );
    expect(helpers).not.toMatch(/Termino indefinido|Prestacion de servicios/);
  });
});
