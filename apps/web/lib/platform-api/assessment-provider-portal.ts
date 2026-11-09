'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { isPlatformApiEnabled, platformGet, platformPost } from './client';

// AS-5 / D16 — the candidate portal's provider assessments live ONLY in C# (no tRPC twin), so the section is dark unless
// BOTH the C# base URL and this opt-in flag are set. Enable it only with Platform__AssessmentProvidersEnabled on.
const VIA_CSHARP = process.env.NEXT_PUBLIC_ASSESSMENT_PROVIDERS_VIA_CSHARP === 'true';

export function isProviderAssessmentsPortalEnabled(): boolean {
  return VIA_CSHARP && isPlatformApiEnabled();
}

export const PORTAL_STATUSES = [
  'consent_needed',
  'ready',
  'in_progress',
  'completed',
  'expired',
  'needs_review',
] as const;
export type PortalStatus = (typeof PORTAL_STATUSES)[number];

export const CONSENT_PURPOSES = ['assessment', 'biometric', 'voice', 'ai_scoring'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

const portalAttemptSchema = z
  .object({
    attemptId: z.string().uuid(),
    instrument: z.string().max(32),
    status: z.enum(PORTAL_STATUSES),
    missingConsents: z.array(z.enum(CONSENT_PURPOSES)).max(4),
    expiresAt: z.string().max(40).datetime({ offset: true }).nullable(),
    delivery: z.enum(['native', 'link_out']),
    /** The candidate's own application's vacancy, named in the consent notice. */
    vacancyId: z.string().uuid(),
    /** OPTIONAL purposes not decided yet (English speaking: voice, ai_scoring); may be declined. */
    optionalConsents: z.array(z.enum(CONSENT_PURPOSES)).max(4),
  })
  .strict();

export type PortalProviderAttempt = z.infer<typeof portalAttemptSchema>;

const portalAttemptsSchema = z.object({ attempts: z.array(portalAttemptSchema).max(50) }).strict();

// RichTextBlock: plain text only (the contract forbids markup). Rendered as text nodes, never as HTML.
const blockSchema = z
  .object({
    type: z.enum(['paragraph', 'heading', 'list', 'callout']),
    text: z.string().max(4000).nullable(),
    level: z.number().int().min(1).max(3).nullable().optional(),
    ordered: z.boolean().nullable().optional(),
    items: z.array(z.string().max(1000)).max(30).nullable().optional(),
    tone: z.enum(['info', 'warning']).nullable().optional(),
  })
  .strict();

export type ConsentBlock = z.infer<typeof blockSchema>;

const templateSchema = z
  .object({
    purpose: z.enum(CONSENT_PURPOSES),
    textVersion: z.string().min(1).max(64),
    locale: z.string().min(2).max(5),
    title: z.string().max(200),
    blocks: z.array(blockSchema).min(1).max(50),
    disclosures: z.array(z.string().max(64)).max(20),
  })
  .strict();

export type ConsentTemplate = z.infer<typeof templateSchema>;

const templatesSchema = z
  .object({
    templates: z.array(templateSchema).max(4),
    /** The purposes among `templates` the candidate may leave unticked (shown apart, unticked by default). */
    optionalPurposes: z.array(z.enum(CONSENT_PURPOSES)).max(4),
  })
  .strict();

export type ConsentTemplateSet = z.infer<typeof templatesSchema>;

const launchSchema = z
  .object({
    delivery: z.enum(['native', 'link_out']),
    expiresAt: z.string().max(40).datetime({ offset: true }),
    hostedUrl: z.string().max(2048).url().startsWith('https://'),
    frameAncestors: z.array(z.string().max(262)).max(20),
  })
  .strict();

export type ProviderLaunch = z.infer<typeof launchSchema>;

export const providerAttemptsKey = (orgSlug: string) => ['platform', 'provider-assessments', orgSlug] as const;

/** GET /portal/assessment-attempts — the signed-in candidate's provider attempts at this organization. */
export function useMyProviderAssessments(orgSlug: string) {
  return useQuery({
    queryKey: providerAttemptsKey(orgSlug),
    enabled: isProviderAssessmentsPortalEnabled(),
    retry: false,
    // A sitting may finish in another tab or in the player: refresh when the candidate comes back.
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<PortalProviderAttempt[]> =>
      portalAttemptsSchema.parse(await platformGet('/portal/assessment-attempts', { organizationSlug: orgSlug }))
        .attempts,
  });
}

/** GET /portal/assessment-attempts/{id}/consent-templates — the texts to accept before launching. */
export function useProviderConsentTemplates(attemptId: string, locale: 'es' | 'en', enabled: boolean) {
  return useQuery({
    queryKey: ['platform', 'provider-consent-templates', attemptId, locale] as const,
    enabled: enabled && isProviderAssessmentsPortalEnabled(),
    retry: false,
    queryFn: async (): Promise<ConsentTemplateSet> =>
      templatesSchema.parse(
        await platformGet('/portal/assessment-attempts/{attemptId}/consent-templates', { locale }, { attemptId }),
      ),
  });
}

export interface AcceptedConsent {
  purpose: ConsentPurpose;
  textVersion: string;
  locale: string;
}

/** The ATS notice the candidate acknowledged: its version and the language it was shown in (recorded by the launch). */
export interface NoticeAcknowledgment {
  textVersion: string;
  locale: 'es' | 'en';
}

/**
 * What the candidate decided before a launch: the texts accepted, the OPTIONAL purposes left unticked, and the ATS
 * notice acknowledged. The notice is REQUIRED to launch a sitting that has not started (422 `notice_required`); only a
 * sitting in progress resumes without it.
 */
export interface ConsentDecision {
  accepted: AcceptedConsent[];
  declined: ConsentPurpose[];
  notice?: NoticeAcknowledgment;
}

/**
 * POST /portal/assessment-attempts/{id}/launch — records the consents the candidate just accepted (and the optional
 * purposes declined) and mints the hosted launch. The returned URL carries a single-use launch code: open it at once,
 * never store or log it.
 */
export async function launchProviderAttempt(
  attemptId: string,
  decision: ConsentDecision,
  embedded: boolean,
): Promise<ProviderLaunch> {
  if (!isProviderAssessmentsPortalEnabled()) throw new Error('Provider assessments are not enabled');
  const { accepted, declined, notice } = decision;
  return launchSchema.parse(
    await platformPost(
      '/portal/assessment-attempts/{attemptId}/launch',
      {
        consents: accepted.length > 0 ? accepted : undefined,
        declinedConsents: declined.length > 0 ? declined : undefined,
        notice,
        embedded,
      },
      { attemptId },
    ),
  );
}
