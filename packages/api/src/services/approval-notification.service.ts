// ---------------------------------------------------------------------------
// Approver notification for vacancy and offer submit-for-approval
// ---------------------------------------------------------------------------
// Pilot UX audit B-01: approvers were never told that something waited for them. Each approver now
// gets their own email (their locale, their name) with a deep link to the item. Callers schedule
// notifyApprovalRequested() with runAfterResponse (lib/after-response.ts), so the send is neither
// frozen by the serverless runtime nor able to delay or fail the submission. It NEVER throws.
// Logs carry ids and counts only: no names, no addresses.

import { runWithTenant } from '@tims/db';
import { getAppUrl, logger } from '@tims/shared';
import { sendEmail } from '../lib/ses';
import {
  approvalNotificationRepository,
  type ApprovalRequestContext,
} from '../repositories/approval-notification.repository';
import { approvalEmailLocale, renderApprovalRequestEmail, type ApprovalKind } from './approval-email-templates';
import { bellNotificationService } from './bell-notification.service';

export type ApprovalRequestedParams = {
  orgId: string;
  kind: ApprovalKind;
  entityId: string;
  approverIds: string[];
  /** The submitter: never emailed about their own request. */
  requesterId: string;
};

export type ApprovalEmailMessage = { to: string; subject: string; html: string };

export const APPROVAL_EMAIL_SEND_TIMEOUT_MS = 4_000;

/**
 * Where an approver reviews the item: the vacancy page, or the offer's own path, which opens the offers
 * page on that offer (apps/web offerLinkPath). Both are PATH-shaped on purpose: a signed-out approver is
 * sent to /login with the pathname kept, so the link still lands on the item after signing in.
 */
export function approvalReviewUrl(appUrl: string, kind: ApprovalKind, entityId: string): string {
  const base = appUrl.replace(/\/+$/, '');
  const id = encodeURIComponent(entityId);
  return kind === 'vacancy' ? `${base}/recruitment/vacancies/${id}` : `${base}/recruitment/offers/${id}`;
}

/** Pure: one message per approver with an address. */
export function buildApprovalRequestEmails(
  data: ApprovalRequestContext,
  kind: ApprovalKind,
  reviewUrl: string,
): ApprovalEmailMessage[] {
  return data.approvers
    .filter((a) => a.email)
    .map((a) => ({
      to: a.email,
      ...renderApprovalRequestEmail({
        kind,
        locale: approvalEmailLocale(a.locale),
        approverFirstName: a.firstName,
        requesterName: data.requesterName,
        companyName: data.companyName,
        vacancyTitle: data.vacancyTitle,
        candidateName: data.candidateName,
        reviewUrl,
      }),
    }));
}

export const approvalNotificationService = {
  async notifyApprovalRequested(params: ApprovalRequestedParams): Promise<void> {
    const log = { component: 'approval-email', kind: params.kind, entityId: params.entityId };
    try {
      const approverIds = [...new Set(params.approverIds)].filter((id) => id !== params.requesterId);
      if (approverIds.length === 0) return;
      // Explicit tenant scope: this runs after the response, outside the request's own middleware.
      const data = await runWithTenant(params.orgId, () =>
        params.kind === 'vacancy'
          ? approvalNotificationRepository.findVacancyRequest(
              params.orgId,
              params.entityId,
              approverIds,
              params.requesterId,
            )
          : approvalNotificationRepository.findOfferRequest(
              params.orgId,
              params.entityId,
              approverIds,
              params.requesterId,
            ),
      );
      if (!data) {
        logger.warn(log, 'Approval request email skipped: item or organization not found');
        return;
      }
      // B-26: the same approvers also get a bell notification (never throws).
      await bellNotificationService.approvalRequested({
        orgId: params.orgId,
        kind: params.kind,
        entityId: params.entityId,
        approvers: data.approvers,
        vacancyTitle: data.vacancyTitle,
        candidateName: data.candidateName,
      });
      const messages = buildApprovalRequestEmails(
        data,
        params.kind,
        approvalReviewUrl(getAppUrl(), params.kind, params.entityId),
      );
      const results = await Promise.allSettled(
        messages.map((m) =>
          sendEmail({
            to: m.to,
            subject: m.subject,
            html: m.html,
            abortSignal: AbortSignal.timeout(APPROVAL_EMAIL_SEND_TIMEOUT_MS),
          }),
        ),
      );
      const failed = results.filter((r) => r.status === 'rejected' || !r.value).length;
      if (failed > 0 || messages.length < approverIds.length) {
        logger.warn(
          { ...log, failed, sent: messages.length - failed, approvers: approverIds.length },
          'Some approval request emails were not sent',
        );
      }
    } catch (error) {
      logger.error(
        { ...log, errName: error instanceof Error ? error.name : 'unknown' },
        'Approval request email failed',
      );
    }
  },
};
