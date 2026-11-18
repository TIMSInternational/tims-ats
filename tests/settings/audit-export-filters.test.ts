/**
 * /settings/audit-log export filters — audit findings D-13 and E-28 (audit-filter part).
 *
 * D-13: "Hasta 09/11" was sent as `new Date('2026-11-09')` = 09/11 00:00 UTC = 08/11 18:00 in Costa Rica, so
 * the whole chosen day (and the evening before) was missing. The range is now the chosen calendar days in
 * the organization's time zone.
 * E-28: "Acción" / "Entidad" were free text matched exactly against codes the placeholder never named
 * ("create, update, delete"); they are now selects of stored codes with Spanish labels.
 */

import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTION_CODES,
  AUDIT_ENTITY_CODES,
  auditExportRange,
  auditFilterOptions,
  isAuditRangeInverted,
} from '../../apps/web/lib/audit-export-filters';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

describe('auditExportRange', () => {
  it('covers the whole chosen days in Costa Rica time (GMT-6)', () => {
    const r = auditExportRange('2026-11-02', '2026-11-09', 'America/Costa_Rica');
    expect(r.dateFrom?.toISOString()).toBe('2026-11-02T06:00:00.000Z');
    // 09/11 23:59:59.999 in Costa Rica = 10/11 05:59:59.999 UTC.
    expect(r.dateTo?.toISOString()).toBe('2026-11-10T05:59:59.999Z');
  });

  it('a single day is that full day; month and year ends roll over', () => {
    const r = auditExportRange('2026-12-31', '2026-12-31', 'America/Costa_Rica');
    expect(r.dateFrom?.toISOString()).toBe('2026-12-31T06:00:00.000Z');
    expect(r.dateTo?.toISOString()).toBe('2027-01-01T05:59:59.999Z');
  });

  it('falls back to UTC (never Bogotá) without a valid organization zone, and leaves empty ends open', () => {
    expect(auditExportRange('', '2026-11-09', null)).toEqual({ dateTo: new Date('2026-11-09T23:59:59.999Z') });
    expect(auditExportRange('2026-11-09', '', 'Not/AZone')).toEqual({ dateFrom: new Date('2026-11-09T00:00:00.000Z') });
    expect(auditExportRange('', '', 'America/Costa_Rica')).toEqual({});
    expect(auditExportRange('09/11/2026', '', 'America/Costa_Rica')).toEqual({});
  });

  it('flags an inverted range', () => {
    expect(isAuditRangeInverted('2026-11-10', '2026-11-09')).toBe(true);
    expect(isAuditRangeInverted('2026-11-09', '2026-11-09')).toBe(false);
    expect(isAuditRangeInverted('', '2026-11-09')).toBe(false);
  });
});

describe('action / entity options', () => {
  it('every code has a Spanish and an English label, and no label is the raw code', () => {
    for (const lang of [es, en]) {
      const actions = auditFilterOptions(AUDIT_ACTION_CODES, lang.auditExport.actions);
      const entities = auditFilterOptions(AUDIT_ENTITY_CODES, lang.auditExport.entities);
      for (const o of [...actions, ...entities]) {
        expect(o.label, o.value).toBeTruthy();
        expect(o.label).not.toBe(o.value);
      }
    }
    expect(Object.keys(es.auditExport.actions).sort()).toEqual([...AUDIT_ACTION_CODES].sort());
    expect(Object.keys(es.auditExport.entities).sort()).toEqual([...AUDIT_ENTITY_CODES].sort());
  });

  it('offers the codes the writers actually store, not the old placeholder words', () => {
    expect(AUDIT_ACTION_CODES).toContain('role_assigned');
    expect(AUDIT_ACTION_CODES).toContain('authz_denied');
    expect(AUDIT_ACTION_CODES).toContain('user_invitation_created');
    expect(AUDIT_ACTION_CODES as readonly string[]).not.toContain('create');
    expect(es.auditExport.actionPlaceholder).not.toMatch(/create|update|delete/);
  });
});
