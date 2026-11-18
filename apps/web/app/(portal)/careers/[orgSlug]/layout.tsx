import { db } from '@tims/db';
import { notFound, redirect } from 'next/navigation';
import { PortalOrgBrandProvider } from './_components/portal-org-brand';

export default async function OrgCareersLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, isActive: true, name: true, logo: true },
  });

  if (!org || !org.isActive) {
    // Slugs are stored lower-case: a link typed or printed as /careers/ACME lands on the real board
    // instead of a 404. (A layout cannot see the rest of the path, so this goes to the board itself.)
    const lower = orgSlug.toLowerCase();
    if (lower !== orgSlug) {
      const match = await db.organization.findUnique({ where: { slug: lower }, select: { isActive: true } });
      if (match?.isActive) redirect(`/careers/${encodeURIComponent(lower)}`);
    }
    notFound();
  }

  return <PortalOrgBrandProvider brand={{ name: org.name, logo: org.logo }}>{children}</PortalOrgBrandProvider>;
}
