import { z } from 'zod';
import { isKnownCurrencyCode } from '../constants/currencies';

// Money boundary schemas (WP-09). Written to run on both zod 3 and zod 4:
// - messages use `{ message }` (the `error` param is zod-4-only);
// - `.finite()` is kept because zod 3 `z.number()` accepts Infinity (a no-op on zod 4);
// - zod 3 wraps a refined object in ZodEffects, so the unrefined object schema is
//   exported too for callers that need `.extend`.

/** An ISO-4217 code; trims and upper-cases. Never defaults to a currency. */
export const currencyCodeSchema = z
  .string()
  .max(16)
  .transform((value) => value.trim().toUpperCase())
  .refine((value) => isKnownCurrencyCode(value), { message: 'invalid_currency' });

/** Upper bound for any single salary amount. */
export const MAX_SALARY_AMOUNT = 1_000_000_000_000;

export const salaryAmountSchema = z.number().finite().nonnegative().max(MAX_SALARY_AMOUNT);

export const SALARY_PERIODS = ['monthly', 'yearly'] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

/** Unrefined vacancy salary object, for callers that `.extend` it. */
export const vacancySalaryObjectSchema = z.object({
  min: salaryAmountSchema.optional(),
  max: salaryAmountSchema.optional(),
  currency: currencyCodeSchema,
  period: z.enum(SALARY_PERIODS),
});

/** Vacancy salary: currency required, amounts bounded, min not above max. */
export const vacancySalarySchema = vacancySalaryObjectSchema.refine(
  (value) => value.min === undefined || value.max === undefined || value.min <= value.max,
  { message: 'salary_min_gt_max', path: ['max'] },
);

export type VacancySalary = z.infer<typeof vacancySalarySchema>;
