import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router } from '../../trpc';
import { db } from '@tims/db';
import { platformProcedure } from './_common';

// ---------------------------------------------------------------------------
// GDPR / Habeas Data (Ley 1581/2012) data-subject requests.
//
// exportSubjectData = the "right to access": bundle everything we hold about a
// person (matched by email across both the User/employee and Candidate sides)
// into a downloadable JSON. Single-subject, so no unbounded-result concern.
// Platform-owner only. Deletion requests are handled manually for now (they
// carry legal-retention nuance + cascade risk) — a separate future capability.
// ---------------------------------------------------------------------------

export const dataRequestsRouter = router({
  exportSubjectData: platformProcedure
    .input(z.object({ email: z.string().email().max(255) }))
    .query(async ({ input }) => {
      // Don't pre-lowercase: stored emails aren't guaranteed normalized, so we
      // rely on Prisma `mode: 'insensitive'` to match regardless of casing.
      const email = input.email.trim();

      const [users, candidates] = await Promise.all([
        db.user.findMany({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: {
            id: true, email: true, firstName: true, lastName: true,
            jobTitle: true, isActive: true, organizationId: true, createdAt: true,
          },
        }),
        db.candidate.findMany({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: {
            id: true, email: true, firstName: true, lastName: true, phone: true,
            source: true, currentTitle: true, organizationId: true, createdAt: true,
          },
        }),
      ]);

      if (users.length === 0 && candidates.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No se encontraron datos para ese correo' });
      }

      const candidateIds = candidates.map((c) => c.id);
      const userIds = users.map((u) => u.id);

      const [applications, interviews, offers, assessments, demographics, compensation] =
        await Promise.all([
          candidateIds.length
            ? db.application.findMany({
                where: { candidateId: { in: candidateIds } },
                select: { id: true, status: true, appliedAt: true, rejectedReason: true, vacancyId: true },
              })
            : [],
          candidateIds.length
            ? db.interview.findMany({
                where: { candidateId: { in: candidateIds } },
                select: { id: true, type: true, status: true, scheduledAt: true },
              })
            : [],
          candidateIds.length
            ? db.offer.findMany({
                where: { candidateId: { in: candidateIds } },
                select: { id: true, status: true, salary: true, currency: true, startDate: true, contractType: true, createdAt: true },
              })
            : [],
          candidateIds.length
            ? db.assessmentAssignment.findMany({
                where: { candidateId: { in: candidateIds } },
                select: {
                  id: true, status: true, assignedAt: true, completedAt: true,
                  assessmentType: { select: { name: true } },
                  result: { select: { normalizedScore: true } },
                },
              })
            : [],
          userIds.length
            ? // Deliberate carve-out: employee.prisma's "DOB never returned raw,
              // only age bands" rule governs ANALYTICS/dashboards. A Habeas-Data /
              // GDPR right-of-access export is the one channel where the subject is
              // entitled to their exact self-ID data, so raw dateOfBirth is correct here.
              db.employeeDemographics.findMany({
                where: { userId: { in: userIds } },
                select: { gender: true, ethnicity: true, nationality: true, disabilityStatus: true, dateOfBirth: true },
              })
            : [],
          userIds.length
            ? db.employeeCompensation.findMany({
                where: { userId: { in: userIds } },
                select: { currentSalary: true, currency: true, effectiveDate: true },
              })
            : [],
        ]);

      const bundle = {
        subject: email,
        generatedAt: new Date().toISOString(),
        identity: { users, candidates },
        recruitment: { applications, interviews, offers, assessments },
        hr: { demographics, compensation },
      };

      return {
        json: JSON.stringify(bundle, null, 2),
        counts: {
          users: users.length,
          candidates: candidates.length,
          applications: applications.length,
          interviews: interviews.length,
          offers: offers.length,
          assessments: assessments.length,
          demographics: demographics.length,
          compensation: compensation.length,
        },
      };
    }),
});
