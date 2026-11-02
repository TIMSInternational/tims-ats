import { describe, it, expect } from 'vitest';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  createCompanySchema,
  MAX_ORG_EMAIL_LENGTH,
  MAX_ORG_DOMAIN_LENGTH,
} from '../../packages/shared/src/validators/organization';

// #213 — `billingEmail` and `domain` were unbounded on `organization.update`, which runs at the
// `organization:update` privilege bar (lower than the platform-owner writers #207 bounded).

/** A syntactically valid hostname of exactly `length` characters, built from 63-char labels. */
function hostnameOfLength(length: number): string {
  const tld = '.com';
  let body = '';
  while (body.length < length - tld.length) {
    const remaining = length - tld.length - body.length;
    if (body.length > 0) {
      if (remaining < 2) break;
      body += '.';
    }
    const labelLength = Math.min(63, length - tld.length - body.length);
    body += 'a'.repeat(labelLength);
  }
  return body + tld;
}

describe('updateOrganizationSchema — billingEmail (#213)', () => {
  const at254 = 'a'.repeat(242) + '@example.com';
  const at255 = 'a'.repeat(243) + '@example.com';

  it('accepts exactly 254 characters and rejects 255', () => {
    expect(at254).toHaveLength(MAX_ORG_EMAIL_LENGTH);
    expect(updateOrganizationSchema.safeParse({ billingEmail: at254 }).success).toBe(true);
    expect(updateOrganizationSchema.safeParse({ billingEmail: at255 }).success).toBe(false);
  });

  it('rejects the multi-kilobyte payload from the issue', () => {
    const huge = 'a'.repeat(5000) + '@x.com';
    expect(updateOrganizationSchema.safeParse({ billingEmail: huge }).success).toBe(false);
  });

  it('trims before validating, and stores the trimmed value', () => {
    const parsed = updateOrganizationSchema.parse({ billingEmail: '  billing@acme.com  ' });
    expect(parsed.billingEmail).toBe('billing@acme.com');
  });

  it('still rejects malformed and empty addresses', () => {
    expect(updateOrganizationSchema.safeParse({ billingEmail: 'not-an-email' }).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ billingEmail: '' }).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ billingEmail: '   ' }).success).toBe(false);
  });

  it('remains optional', () => {
    expect(updateOrganizationSchema.safeParse({}).success).toBe(true);
    expect(updateOrganizationSchema.safeParse({ logo: 'https://cdn.example.com/l.png' }).success).toBe(true);
  });
});

describe('updateOrganizationSchema — domain (#213)', () => {
  it('accepts ordinary hostnames, subdomains and punycode', () => {
    for (const domain of ['acme.com', 'ACME.co', 'mail.acme.com.co', 'my-co.io', 'xn--80ak6aa92e.com']) {
      expect(updateOrganizationSchema.safeParse({ domain }).success, domain).toBe(true);
    }
  });

  it('accepts exactly 253 characters and rejects 254', () => {
    const at253 = hostnameOfLength(253);
    const at254 = hostnameOfLength(254);
    expect(at253).toHaveLength(MAX_ORG_DOMAIN_LENGTH);
    expect(at254).toHaveLength(MAX_ORG_DOMAIN_LENGTH + 1);
    expect(updateOrganizationSchema.safeParse({ domain: at253 }).success).toBe(true);
    expect(updateOrganizationSchema.safeParse({ domain: at254 }).success).toBe(false);
  });

  it('rejects a 10 MB string', () => {
    expect(updateOrganizationSchema.safeParse({ domain: 'a'.repeat(10 * 1024 * 1024) + '.com' }).success).toBe(false);
  });

  it('rejects values that are not a bare hostname', () => {
    const bad = [
      '',
      'localhost',
      'https://acme.com',
      'acme.com/path',
      'acme.com:443',
      'user@acme.com',
      'acme .com',
      '-acme.com',
      'acme-.com',
      'acme..com',
      'acme.com.',
      '192.168.0.1',
      'a'.repeat(64) + '.com', // label over 63
      'acme.c<script>',
    ];
    for (const domain of bad) {
      expect(updateOrganizationSchema.safeParse({ domain }).success, JSON.stringify(domain)).toBe(false);
    }
  });

  it('trims before validating, and stores the trimmed value', () => {
    expect(updateOrganizationSchema.parse({ domain: '  acme.com\n' }).domain).toBe('acme.com');
  });

  it('applies the same bounds on createOrganizationSchema', () => {
    const base = { name: 'Acme', slug: 'acme' };
    expect(createOrganizationSchema.safeParse({ ...base, domain: 'acme.com' }).success).toBe(true);
    expect(createOrganizationSchema.safeParse({ ...base, domain: hostnameOfLength(254) }).success).toBe(false);
    expect(
      createOrganizationSchema.safeParse({ ...base, billingEmail: 'a'.repeat(243) + '@example.com' }).success,
    ).toBe(false);
  });
});

describe('createCompanySchema — sweep of unbounded strings (#213)', () => {
  const base = { name: 'Acme SAS', country: 'CO' };

  it('accepts the documented maxima', () => {
    expect(
      createCompanySchema.safeParse({
        ...base,
        timezone: 'a'.repeat(64),
        legalName: 'a'.repeat(200),
        taxId: 'a'.repeat(50),
      }).success,
    ).toBe(true);
  });

  it('rejects one over each bound', () => {
    expect(createCompanySchema.safeParse({ ...base, timezone: 'a'.repeat(65) }).success).toBe(false);
    expect(createCompanySchema.safeParse({ ...base, legalName: 'a'.repeat(201) }).success).toBe(false);
    expect(createCompanySchema.safeParse({ ...base, taxId: 'a'.repeat(51) }).success).toBe(false);
  });

  it('keeps the timezone default', () => {
    expect(createCompanySchema.parse(base).timezone).toBe('America/Bogota');
  });
});
