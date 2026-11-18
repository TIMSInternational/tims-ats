import { markdownToPlainText } from '../../../../../lib/markdown-lite';
import { isCspAllowedImageUrl } from '../../../../../lib/security/csp-img-src';
import { parsePortalSalary } from './vacancy-display';

// schema.org JobPosting for a public vacancy page, so search engines can list the vacancy as a job. Built only
// from what the page itself shows the anonymous visitor: the title, the description (as plain text), the
// posting date the page shows ("Publicado hace…"), the contract type, the location, the hiring company's name
// (and the organization's logo when the page shows it), and the salary only when the page shows one. Nothing
// the page hides is added. Pure module: the read lives in job-posting-source.ts.

/** The vacancy fields the builder reads (job-posting-source.ts selects exactly these). */
export interface JobPostingSource {
  title: string;
  description: string | null;
  socialDescription: string | null;
  location: string | null;
  remotePolicy: string | null;
  contractType: string | null;
  salary: unknown;
  createdAt: Date;
  company: { name: string } | null;
  organization: { name: string; logo: string | null };
}

type JsonLdValue = string | number | boolean | null | JsonLdObject | JsonLdValue[];
export interface JsonLdObject {
  [key: string]: JsonLdValue;
}

// Contract types (portal.contractTypes) → schema.org employmentType. 'indefinido' (a permanent contract) says
// nothing about full or part time, so it maps to nothing rather than to a guess; so do legacy free-text values.
const EMPLOYMENT_TYPES = new Map<string, string>([
  ['termino_fijo', 'TEMPORARY'],
  ['obra_labor', 'TEMPORARY'],
  ['temporal', 'TEMPORARY'],
  ['prestacion', 'CONTRACTOR'],
  ['practicas', 'INTERN'],
]);

// Stored salary periods (vacancy-display.ts salaryPeriodLabel) → schema.org QuantitativeValue unitText.
const SALARY_UNITS = new Map<string, string>([
  ['monthly', 'MONTH'],
  ['yearly', 'YEAR'],
  ['annual', 'YEAR'],
]);

function plainDescription(source: JobPostingSource): string | null {
  const fromDescription = source.description?.trim() ? markdownToPlainText(source.description).trim() : '';
  if (fromDescription) return fromDescription;
  const fromSocial = source.socialDescription?.trim() ?? '';
  return fromSocial || null;
}

/**
 * baseSalary, only when the page shows a salary (the same parsePortalSalary rule) and it names a currency: an
 * amount with no currency is not a valid MonetaryAmount. "Desde X" is a minimum only, "Hasta X" a maximum only.
 */
function baseSalary(raw: unknown): JsonLdObject | null {
  const salary = parsePortalSalary(raw);
  if (!salary?.currency) return null;
  const value: JsonLdObject = { '@type': 'QuantitativeValue' };
  if (salary.min !== undefined && salary.max !== undefined && salary.min === salary.max) {
    value.value = salary.min;
  } else {
    if (salary.min !== undefined) value.minValue = salary.min;
    if (salary.max !== undefined) value.maxValue = salary.max;
  }
  const unit = salary.period ? SALARY_UNITS.get(salary.period) : undefined;
  if (unit) value.unitText = unit;
  return { '@type': 'MonetaryAmount', currency: salary.currency, value };
}

/** The JobPosting object, or null when the vacancy has no description to describe it with. */
export function buildJobPosting(source: JobPostingSource): JsonLdObject | null {
  const title = source.title.trim();
  const description = plainDescription(source);
  if (!title || !description) return null;

  // The page names the vacancy's client company when it has one, else the organization; the organization's
  // logo stands for it only when there is no separate client company (job-detail-view.tsx).
  const companyName = source.company?.name?.trim();
  const logo = companyName ? null : source.organization.logo?.trim();
  const hiringOrganization: JsonLdObject = { '@type': 'Organization', name: companyName || source.organization.name };
  if (logo && isCspAllowedImageUrl(logo)) hiringOrganization.logo = logo;

  const posting: JsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title,
    description,
    datePosted: source.createdAt.toISOString(),
    hiringOrganization,
  };
  const employmentType = source.contractType ? EMPLOYMENT_TYPES.get(source.contractType) : undefined;
  if (employmentType) posting.employmentType = employmentType;
  const location = source.location?.trim();
  if (location) {
    posting.jobLocation = { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: location } };
  }
  if (source.remotePolicy === 'remote') posting.jobLocationType = 'TELECOMMUTE';
  const salary = baseSalary(source.salary);
  if (salary) posting.baseSalary = salary;
  return posting;
}

const JSON_LD_ESCAPES = new Map<string, string>([
  ['<', '\\u003c'],
  ['>', '\\u003e'],
  ['&', '\\u0026'],
  ['\u2028', '\\u2028'],
  ['\u2029', '\\u2029'],
]);

/**
 * JSON for a `<script type="application/ld+json">` body. `<`, `>` and `&` are written as JSON unicode escapes,
 * so no text from the vacancy can close the script element or open markup; the parsed value is unchanged.
 */
export function serializeJsonLd(value: JsonLdObject): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => JSON_LD_ESCAPES.get(char) ?? char);
}
