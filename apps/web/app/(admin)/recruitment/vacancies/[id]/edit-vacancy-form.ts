import { DEFAULT_TENANT_CURRENCY } from '../../../../../lib/tenant-locale';
import { formatMoneyAmount, isSalaryBandBlocked, salaryBandStatus } from '../../../../../lib/money-amount';

/**
 * Pure state helpers for the vacancy "Editar" drawer: the form is seeded from the vacancy detail, and only the
 * fields the user actually changed are sent to `vacancy.update` (so an untouched salary, assignee or legacy
 * value is never rewritten).
 */

export type RemotePolicy = 'onsite' | 'remote' | 'hybrid';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type SalaryPeriod = 'monthly' | 'yearly';

/** Statuses the server lets `vacancy.update` write (vacancy-lifecycle.repository.ts). */
export const EDITABLE_VACANCY_STATUSES: readonly string[] = ['draft', 'approved', 'published', 'frozen'];

export function isVacancyEditable(status: string): boolean {
  return EDITABLE_VACANCY_STATUSES.includes(status);
}

export interface EditableVacancy {
  title: string;
  description: string | null;
  location: string | null;
  remotePolicy: string | null;
  contractType: string | null;
  positions: number;
  priority: string;
  salary: unknown;
  assignee: { id: string; firstName: string; lastName: string } | null;
}

export interface HiringManager {
  id: string;
  firstName: string;
  lastName: string;
}

export interface EditVacancyForm {
  title: string;
  description: string;
  location: string;
  remotePolicy: RemotePolicy | '';
  contractType: string;
  positions: number;
  priority: Priority;
  salaryMin: string;
  salaryMax: string;
  currency: string;
  salaryPeriod: SalaryPeriod;
  hiringManager: HiringManager | null;
}

export interface VacancyUpdatePatch {
  title?: string;
  description?: string;
  location?: string | null;
  remotePolicy?: RemotePolicy | null;
  contractType?: string | null;
  positions?: number;
  priority?: Priority;
  salary?: { min?: number; max?: number; currency: string; period: SalaryPeriod };
  assignedTo?: string | null;
}

const REMOTE_POLICIES: readonly string[] = ['onsite', 'remote', 'hybrid'];
const PRIORITIES: readonly string[] = ['low', 'medium', 'high', 'urgent'];

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/** A stored amount as the band input shows it: grouped digits in the tenant locale ("850 000"). */
function amountText(value: unknown, currency: string): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? formatMoneyAmount(value, currency) : '';
}

/** The form with `tenantCurrency` where no currency is stored or chosen yet (an explicit one is kept). */
export function withDefaultCurrency(form: EditVacancyForm, tenantCurrency: string): EditVacancyForm {
  return form.currency ? form : { ...form, currency: tenantCurrency };
}

/**
 * `tenantCurrency` (the organization's, lib/tenant-locale-context.tsx) fills a vacancy saved without one. The
 * drawer passes '' and applies the tenant's at render with `withDefaultCurrency`, so a profile that loads
 * after the drawer opened is still used.
 */
export function initialEditForm(v: EditableVacancy, tenantCurrency: string = DEFAULT_TENANT_CURRENCY): EditVacancyForm {
  const salary = asRecord(v.salary);
  const currency =
    typeof salary.currency === 'string' && salary.currency.trim() ? salary.currency.trim().toUpperCase() : '';
  return {
    title: v.title,
    description: v.description ?? '',
    location: v.location ?? '',
    remotePolicy: v.remotePolicy && REMOTE_POLICIES.includes(v.remotePolicy) ? (v.remotePolicy as RemotePolicy) : '',
    contractType: v.contractType ?? '',
    positions: v.positions,
    priority: PRIORITIES.includes(v.priority) ? (v.priority as Priority) : 'medium',
    salaryMin: amountText(salary.min, currency || tenantCurrency),
    salaryMax: amountText(salary.max, currency || tenantCurrency),
    currency: currency || tenantCurrency,
    salaryPeriod: salary.period === 'yearly' || salary.period === 'annual' ? 'yearly' : 'monthly',
    hiringManager: v.assignee
      ? { id: v.assignee.id, firstName: v.assignee.firstName, lastName: v.assignee.lastName }
      : null,
  };
}

/**
 * Amounts are parsed by lib/money-amount.ts, the same parser as the creation wizard and the offer form: digit
 * grouping is accepted ("1.200.000", "1,200,000", "1 200 000"), and a zero-decimal currency (CRC, COP…) takes
 * whole numbers only. A typed amount equal to the stored one is not a change (re-grouping is not an edit).
 */
function salaryChanged(initial: EditVacancyForm, form: EditVacancyForm): boolean {
  if (form.currency !== initial.currency || form.salaryPeriod !== initial.salaryPeriod) return true;
  const before = salaryBandStatus(initial.salaryMin, initial.salaryMax, initial.currency);
  const after = salaryBandStatus(form.salaryMin, form.salaryMax, form.currency);
  if (after.invalid) return true;
  return after.min !== before.min || after.max !== before.max;
}

export type EditFormError = 'titleRequired' | 'salaryInvalid' | 'salaryRange' | 'salaryWide' | null;

/**
 * The salary band is only validated when it was touched: a stored value never blocks an unrelated edit.
 * `confirmedRangeKey` is the band the person confirmed although its minimum is below a tenth of its maximum.
 */
export function validateEditForm(
  initial: EditVacancyForm,
  form: EditVacancyForm,
  confirmedRangeKey: string | null = null,
): EditFormError {
  if (!form.title.trim()) return 'titleRequired';
  if (!salaryChanged(initial, form)) return null;
  const status = salaryBandStatus(form.salaryMin, form.salaryMax, form.currency);
  if (status.invalid) return 'salaryInvalid';
  if (status.range.error) return 'salaryRange';
  if (isSalaryBandBlocked(status, confirmedRangeKey)) return 'salaryWide';
  return null;
}

const nullIfBlank = (text: string): string | null => (text.trim() ? text.trim() : null);

/**
 * The `vacancy.update` fields that differ from the seeded form, or null when nothing changed. Call only on a
 * form that passed validateEditForm.
 */
export function buildVacancyPatch(initial: EditVacancyForm, form: EditVacancyForm): VacancyUpdatePatch | null {
  const patch: VacancyUpdatePatch = {};
  if (form.title.trim() !== initial.title.trim()) patch.title = form.title.trim();
  if (form.description.trim() !== initial.description.trim()) patch.description = form.description.trim();
  if (nullIfBlank(form.location) !== nullIfBlank(initial.location)) patch.location = nullIfBlank(form.location);
  if (form.remotePolicy !== initial.remotePolicy) patch.remotePolicy = form.remotePolicy || null;
  if (form.contractType !== initial.contractType) patch.contractType = form.contractType || null;
  if (form.positions !== initial.positions) patch.positions = form.positions;
  if (form.priority !== initial.priority) patch.priority = form.priority;

  if (salaryChanged(initial, form)) {
    const { min, max } = salaryBandStatus(form.salaryMin, form.salaryMax, form.currency);
    patch.salary = {
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      currency: form.currency,
      period: form.salaryPeriod,
    };
  }

  if ((form.hiringManager?.id ?? null) !== (initial.hiringManager?.id ?? null)) {
    patch.assignedTo = form.hiringManager?.id ?? null;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
