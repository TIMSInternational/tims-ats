import 'server-only';
import type { Metadata } from 'next';
import { db } from '@tims/db';
import es from '../../../../../lib/i18n/es.json';
import { markdownToPlainText } from '../../../../../lib/markdown-lite';
import { isCspAllowedImageUrl } from '../../../../../lib/security/csp-img-src';

// Server-rendered <head> for the public careers pages, so a vacancy link shared on WhatsApp or
// LinkedIn previews as "<vacancy> — <organization>" with a real description instead of the app's
// generic title. The pages themselves still render client-side; only the metadata is read here.
// Copy comes from the Spanish catalogue: crawlers and link previews have no locale preference.

const DESCRIPTION_MAX = 160;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BoardMetadataSource {
  name: string;
  logo: string | null;
}

export interface VacancyMetadataSource {
  title: string;
  description: string | null;
  socialDescription: string | null;
  organization: BoardMetadataSource;
}

/** Plain text, whitespace-collapsed, cut on a word boundary to fit a link preview. */
export function excerpt(text: string, max: number = DESCRIPTION_MAX): string {
  const plain = text.replace(/\s+/g, ' ').trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:–-]+$/, '')}…`;
}

function fill(template: string, org: string): string {
  return template.replace('{org}', org);
}

function previewImages(logo: string | null): { url: string }[] | undefined {
  const url = logo?.trim();
  return url && isCspAllowedImageUrl(url) ? [{ url }] : undefined;
}

function socialMetadata(title: string, description: string, org: BoardMetadataSource): Metadata {
  const images = previewImages(org.logo);
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: org.name,
      locale: 'es_CR',
      ...(images ? { images } : {}),
    },
    twitter: { card: 'summary', title, description },
  };
}

export function buildBoardMetadata(org: BoardMetadataSource | null): Metadata {
  if (!org) return { title: es.notFound.title, robots: { index: false, follow: false } };
  return socialMetadata(fill(es.portal.metaBoardTitle, org.name), fill(es.portal.metaBoardDescription, org.name), org);
}

export function buildVacancyMetadata(vacancy: VacancyMetadataSource | null): Metadata {
  if (!vacancy) return { title: es.portal.vacancyNotFound, robots: { index: false, follow: false } };
  const org = vacancy.organization;
  const fromSocial = vacancy.socialDescription?.trim() ? excerpt(vacancy.socialDescription) : '';
  const fromDescription = vacancy.description?.trim() ? excerpt(markdownToPlainText(vacancy.description)) : '';
  const description = fromSocial || fromDescription || fill(es.portal.metaVacancyDescription, org.name);
  return socialMetadata(`${vacancy.title} — ${org.name}`, description, org);
}

/** The active organization behind a careers slug (exact match, as the layout resolves it). */
export async function loadBoardMetadataSource(orgSlug: string): Promise<BoardMetadataSource | null> {
  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { name: true, logo: true, isActive: true },
  });
  return org && org.isActive ? { name: org.name, logo: org.logo } : null;
}

/** A PUBLISHED vacancy of that organization — the same visibility rule as portal.getVacancy. */
export async function loadVacancyMetadataSource(
  orgSlug: string,
  vacancyId: string,
): Promise<VacancyMetadataSource | null> {
  if (!UUID_RE.test(vacancyId)) return null;
  const vacancy = await db.vacancy.findFirst({
    where: {
      id: vacancyId,
      status: 'published',
      deletedAt: null,
      organization: { is: { slug: orgSlug, isActive: true } },
    },
    select: {
      title: true,
      description: true,
      socialDescription: true,
      organization: { select: { name: true, logo: true } },
    },
  });
  return vacancy;
}
