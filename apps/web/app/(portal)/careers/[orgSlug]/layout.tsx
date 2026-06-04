import { db } from '@tims/db';
import { notFound } from 'next/navigation';

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
    select: { id: true, isActive: true },
  });

  if (!org || !org.isActive) notFound();

  return <>{children}</>;
}
