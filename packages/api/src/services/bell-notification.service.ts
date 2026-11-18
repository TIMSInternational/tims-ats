// ---------------------------------------------------------------------------
// Tenant bell (in-app) notifications: approval requests and interview panel assignments
// ---------------------------------------------------------------------------
// Pilot UX re-audit B-26 / hiring-team ideal-76: the navbar bell had no tenant producer (lib/notify.ts is used
// by platform events only). Each approver now gets one bell row per approval request, and each evaluator one
// per panel assignment, next to the existing emails. Staff copy, so the Spanish uses "tú".
// NEVER throws (callers run it after the response). It never falls back to platform owners, unlike
// lib/notify.ts with no recipients: an empty recipient list writes nothing. Logs carry ids and counts only.
// Pilot launch-spine change under owner decision D-1; owed a C# port with the notification module.

import { runWithTenant } from '@tims/db';
import { logger } from '@tims/shared';
import { notificationService } from './notification.service';
import { bellNotificationRepository, type BellRecipient } from '../repositories/bell-notification.repository';

type BellLocale = 'es' | 'en';
type BellText = { title: string; message: string };
type BellTarget = { module: string; entityType: string; entityId: string; actionUrl: string };

const COPY = {
  es: {
    vacancyApproval: (title: string) => `Tienes una vacante por aprobar: ${title}`,
    offerApproval: (candidate: string, title: string) => `Tienes una oferta por aprobar: ${candidate} (${title})`,
    approvalMessage: 'Revísala y apruébala o recházala desde TIMS.',
    panel: (candidate: string, title: string) => `Te asignaron a una entrevista: ${candidate} (${title})`,
    panelMessage: 'Abre la sala de la entrevista para ver los detalles y registrar tu calificación.',
  },
  en: {
    vacancyApproval: (title: string) => `A vacancy is waiting for your approval: ${title}`,
    offerApproval: (candidate: string, title: string) => `An offer is waiting for your approval: ${candidate} (${title})`,
    approvalMessage: 'Review it and approve or reject it in TIMS.',
    panel: (candidate: string, title: string) => `You were added to an interview panel: ${candidate} (${title})`,
    panelMessage: 'Open the interview room to see the details and record your score.',
  },
} as const;

function bellLocale(value: string | null | undefined): BellLocale {
  return value?.toLowerCase().startsWith('en') ? 'en' : 'es';
}

/** One bell row per recipient, in their locale. Recipients must be active members of `orgId`. */
async function notifyRecipients(
  orgId: string,
  recipients: readonly BellRecipient[],
  text: (locale: BellLocale) => BellText,
  target: BellTarget,
): Promise<void> {
  const log = { component: 'bell-notify', module: target.module, entityId: target.entityId };
  const byLocale = new Map<BellLocale, string[]>();
  for (const r of recipients) {
    const locale = bellLocale(r.locale);
    const ids = byLocale.get(locale) ?? [];
    if (!ids.includes(r.id)) ids.push(r.id);
    byLocale.set(locale, ids);
  }
  for (const [locale, userIds] of byLocale) {
    try {
      await notificationService.bulkCreate(orgId, userIds, { type: 'info', ...text(locale), ...target });
    } catch (error) {
      logger.warn(
        { ...log, recipients: userIds.length, errName: error instanceof Error ? error.name : 'unknown' },
        'Bell notification not written',
      );
    }
  }
}

export type ApprovalBellParams = {
  orgId: string;
  kind: 'vacancy' | 'offer';
  entityId: string;
  /** Active approvers (already without the requester), as the approval email read them. */
  approvers: readonly BellRecipient[];
  vacancyTitle: string;
  candidateName?: string | null;
};

export const bellNotificationService = {
  async approvalRequested(params: ApprovalBellParams): Promise<void> {
    if (params.approvers.length === 0) return;
    const id = encodeURIComponent(params.entityId);
    await notifyRecipients(
      params.orgId,
      params.approvers,
      (locale) => ({
        title:
          params.kind === 'vacancy'
            ? COPY[locale].vacancyApproval(params.vacancyTitle)
            : COPY[locale].offerApproval(params.candidateName ?? '', params.vacancyTitle),
        message: COPY[locale].approvalMessage,
      }),
      {
        module: params.kind === 'vacancy' ? 'vacancy' : 'offer',
        entityType: params.kind,
        entityId: params.entityId,
        actionUrl: params.kind === 'vacancy' ? `/recruitment/vacancies/${id}` : `/recruitment/offers/${id}`,
      },
    );
  },

  /** Evaluators added to an interview panel (on create, or one added later); the actor is never notified. */
  async panelAssigned(orgId: string, interviewId: string, userIds: readonly string[], actorId: string): Promise<void> {
    try {
      const targets = [...new Set(userIds)].filter((id) => id !== actorId);
      if (targets.length === 0) return;
      const { interview, recipients } = await runWithTenant(orgId, async () => ({
        interview: await bellNotificationRepository.interviewSummary(orgId, interviewId),
        recipients: await bellNotificationRepository.activeMembers(orgId, targets),
      }));
      if (!interview || recipients.length === 0) return;
      const candidate = `${interview.candidate.firstName} ${interview.candidate.lastName}`.trim();
      await notifyRecipients(
        orgId,
        recipients,
        (locale) => ({ title: COPY[locale].panel(candidate, interview.vacancy.title), message: COPY[locale].panelMessage }),
        {
          module: 'interview',
          entityType: 'interview',
          entityId: interviewId,
          actionUrl: `/recruitment/interviews/${encodeURIComponent(interviewId)}/room`,
        },
      );
    } catch (error) {
      logger.warn(
        { component: 'bell-notify', module: 'interview', entityId: interviewId, errName: error instanceof Error ? error.name : 'unknown' },
        'Panel bell notification not written',
      );
    }
  },
};
