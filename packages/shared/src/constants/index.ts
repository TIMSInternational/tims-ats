export const APP_NAME = 'TIMS Platform';
export const APP_DOMAIN = 'tims.com';
export const SUPPORT_EMAIL = 'soporte@tims.com';

export const PLANS = ['trial', 'starter', 'professional', 'enterprise'] as const;
export type Plan = typeof PLANS[number];

export const LOCALES = ['es', 'en'] as const;
export type Locale = typeof LOCALES[number];
export const DEFAULT_LOCALE: Locale = 'es';

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 25,
  MAX_PAGE_SIZE: 100,
} as const;

export const PASSWORD_MIN_LENGTH = 8;
export const SESSION_EXPIRY_HOURS = 24;
export const MFA_REQUIRED_ROLES = ['super_admin', 'hr_admin', 'hrbp'] as const;
