import { deiRepository } from '../repositories/dei.repository';
import { buildDistribution } from '@tims/shared';
import { buildPdfReport, buildXlsxReport, type ReportSection } from './dei-report-builder';

// ---------------------------------------------------------------------------
// DEI service — turns demographic aggregates into the metrics the dashboard
// shows. All inputs are already grouped counts (no individual rows); this layer
// only computes percentages via the shared distribution kernel.
//
// The suppression + shaping logic lives in the PURE @tims/shared/dei.ts kernel
// (buildDistribution), golden-fixtured against contracts/dei-fixtures/*.json and
// shared byte-for-byte with the C# port (Tims.Domain.Dei.DeiKernels, Phase-5
// Slice 11b). This service only threads the repository aggregates into that
// kernel and maps the generic {key,count} distribution shape to each endpoint's
// field name.
//
// k-anonymity (Wave 2.5 slice 6, matrix §21): a demographic group of 1..4 people
// re-identifies individuals, so the kernel routes every per-group head-count
// through the min-5 floor and, when ANY group/bucket is sub-floor, emits an EMPTY
// distribution (no per-group keys) + a single top-level `suppressed: true`. min-5
// IS the disclosure mechanism here — it sits on top of the `dei:read` grant.
//
// TS-DELETION (2026-07-31): getDashboardKpis / getGenderRepresentation /
// getAgeDistribution / getNationalityDiversity / getPayEquity /
// getLeadershipDiversity were deleted (their sole caller, the router's matching
// procedure, was deleted after NEXT_PUBLIC_DEI_READ_VIA_CSHARP went live) — see
// packages/api/src/routers/dei.ts. Only getEthnicityDistribution and
// getDisabilityDistribution remain here.
//
// #60 (2026-08-06): those two methods are no longer ROUTER-EXPOSED — their tRPC
// procedures were deleted once their live C# replacements' authz + min-5 guards
// were verified at file:line (see the router's TS-DELETION note). They are kept
// as service methods because generateReport is their sole remaining caller; the
// C# reads (/dei/ethnicity-distribution, /dei/disability-distribution) serve
// anything that needs them over HTTP. Do not re-export them from the router
// without a reason — a second live implementation of a k-anonymity-sensitive
// read is exactly what the cutover removed.
//
// generateReport (real, 2026-07-31): renders getEthnicityDistribution +
// getDisabilityDistribution — the only two aggregate metrics this service still
// computes — into an actual xlsx/pdf document via dei-report-builder.ts. Stays
// AGGREGATE-ONLY like everything else here: it never queries EmployeeDemographics
// itself, only reuses the two suppression-safe distribution methods below, so a
// sub-floor group can never reach the exported file as rows. It was NEVER ported
// to C# (see the router note + closed #1) and is deliberately retained.
// ---------------------------------------------------------------------------

const REPORT_SECTIONS = {
  ethnicity: 'Ethnicity Distribution',
  disability: 'Disability Status Distribution',
} as const;

type ReportSectionKey = keyof typeof REPORT_SECTIONS;

const REPORT_MIME_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

export const deiService = {
  async getEthnicityDistribution(orgId: string) {
    const counts = await deiRepository.ethnicityCounts(orgId);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    const sorted = counts.map((c) => ({ key: c.ethnicity, count: c._count._all })).sort((a, b) => b.count - a.count);
    const dist = buildDistribution(sorted, total);
    return {
      groups: dist.groups.map((g) => ({
        ethnicity: g.key,
        count: g.count,
        percentage: g.percentage,
        suppressed: g.suppressed,
      })),
      suppressed: dist.suppressed,
    };
  },

  async getDisabilityDistribution(orgId: string) {
    const counts = await deiRepository.disabilityCounts(orgId);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    const dist = buildDistribution(
      counts.map((c) => ({ key: c.disabilityStatus, count: c._count._all })),
      total,
    );
    return {
      groups: dist.groups.map((g) => ({
        status: g.key,
        count: g.count,
        percentage: g.percentage,
        suppressed: g.suppressed,
      })),
      suppressed: dist.suppressed,
    };
  },

  async generateReport(orgId: string, input: { format: 'pdf' | 'xlsx'; sections?: string[] }) {
    const allKeys = Object.keys(REPORT_SECTIONS) as ReportSectionKey[];
    const requestedKeys = input.sections?.length ? allKeys.filter((key) => input.sections!.includes(key)) : allKeys;

    const sections: ReportSection[] = [];

    if (requestedKeys.includes('ethnicity')) {
      const dist = await deiService.getEthnicityDistribution(orgId);
      sections.push({
        key: 'ethnicity',
        title: REPORT_SECTIONS.ethnicity,
        columns: ['Ethnicity', 'Count', 'Percentage'],
        rows: dist.groups.map((g) => [
          g.ethnicity,
          g.count == null ? '' : String(g.count),
          g.percentage == null ? '' : `${g.percentage}%`,
        ]),
        suppressed: dist.suppressed,
      });
    }

    if (requestedKeys.includes('disability')) {
      const dist = await deiService.getDisabilityDistribution(orgId);
      sections.push({
        key: 'disability',
        title: REPORT_SECTIONS.disability,
        columns: ['Status', 'Count', 'Percentage'],
        rows: dist.groups.map((g) => [
          g.status,
          g.count == null ? '' : String(g.count),
          g.percentage == null ? '' : `${g.percentage}%`,
        ]),
        suppressed: dist.suppressed,
      });
    }

    const generatedAt = new Date();
    const buffer =
      input.format === 'xlsx'
        ? await buildXlsxReport(generatedAt, sections)
        : await buildPdfReport(generatedAt, sections);

    return {
      status: 'ready' as const,
      format: input.format,
      mimeType: REPORT_MIME_TYPES[input.format],
      filename: `dei-report-${generatedAt.toISOString().slice(0, 10)}.${input.format}`,
      data: buffer.toString('base64'),
      sections: sections.map((s) => s.key),
      generatedAt: generatedAt.toISOString(),
    };
  },
};
