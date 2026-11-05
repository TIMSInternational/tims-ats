import { describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import {
  benefitsFromText,
  benefitsToText,
  buildOfferTerms,
  choiceFor,
  choiceText,
  contractTypeSlugs,
  editableSalary,
  LEGACY_CHOICE,
  MAX_OFFER_BENEFITS,
  REMOTE_POLICIES,
} from '../../apps/web/app/(admin)/recruitment/candidates/[id]/create-offer-form';

const contractLabels = es.portal.contractTypes as Record<string, string>;
const remoteLabels = es.portal.remotePolicies as Record<string, string>;

describe('offer form vocabularies (B-15)', () => {
  it('uses the Costa Rican contract-type labels of the vacancy form', () => {
    expect(contractTypeSlugs()).toEqual([
      'indefinido',
      'termino_fijo',
      'obra_labor',
      'prestacion',
      'temporal',
      'practicas',
    ]);
    expect(choiceText({ value: 'termino_fijo', legacy: null }, contractLabels)).toBe('Plazo fijo');
    expect(choiceText({ value: 'obra_labor', legacy: null }, contractLabels)).toBe('Por obra determinada');
  });

  it('maps a vacancy slug, a stored label or a legacy free text back to a choice', () => {
    const slugs = contractTypeSlugs();
    expect(choiceFor('prestacion', slugs, contractLabels)).toEqual({ value: 'prestacion', legacy: null });
    expect(choiceFor('Plazo indefinido', slugs, contractLabels)).toEqual({ value: 'indefinido', legacy: null });
    expect(choiceFor('Test', slugs, contractLabels)).toEqual({ value: LEGACY_CHOICE, legacy: 'Test' });
    expect(choiceText({ value: LEGACY_CHOICE, legacy: 'Test' }, contractLabels)).toBe('Test');
    expect(choiceFor(null, slugs, contractLabels)).toEqual({ value: '', legacy: null });
    expect(choiceFor('hybrid', REMOTE_POLICIES, remoteLabels)).toEqual({ value: 'hybrid', legacy: null });
    expect(choiceText({ value: 'hybrid', legacy: null }, remoteLabels)).toBe('Híbrido');
  });
});

describe('editing a stored annual salary', () => {
  it('shows a monthly amount only when it is exact to the cent, so an untouched save never shifts it', () => {
    expect(editableSalary(12_000_000, 'monthly')).toEqual({ amount: '1000000', period: 'monthly' });
    expect(editableSalary(1_000_000, 'monthly')).toEqual({ amount: '1000000', period: 'yearly' });
    expect(editableSalary(96_000, 'yearly')).toEqual({ amount: '96000', period: 'yearly' });
  });
});

describe('offer terms and benefits', () => {
  it('stores one benefit per line, trimmed and bounded', () => {
    expect(benefitsFromText('  Seguro médico \n\n Aguinaldo ')).toEqual({ '1': 'Seguro médico', '2': 'Aguinaldo' });
    expect(benefitsFromText('   \n ')).toBeUndefined();
    const many = Array.from({ length: 15 }, (_, i) => `B${i}`).join('\n');
    expect(Object.keys(benefitsFromText(many) ?? {})).toHaveLength(MAX_OFFER_BENEFITS);
    expect(benefitsToText({ '1': 'Seguro médico', '2': 'Aguinaldo' })).toBe('Seguro médico\nAguinaldo');
  });

  it('keeps terms the form does not edit, and an emptied field removes its key', () => {
    expect(
      buildOfferTerms(
        { reportingTo: 'Gerencia', schedule: 'L-V', bonus: 'Anual' },
        { schedule: '', modality: 'Remoto', bonus: ' Anual ' },
      ),
    ).toEqual({ reportingTo: 'Gerencia', modality: 'Remoto', bonus: 'Anual' });
  });
});
