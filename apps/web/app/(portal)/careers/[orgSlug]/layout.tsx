import { db } from '@tims/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { TRPCProvider } from '../../../../lib/trpc-provider';
import { I18nProvider } from '../../../../lib/i18n';

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
    select: { id: true, name: true, slug: true, isActive: true },
  });

  if (!org || !org.isActive) notFound();

  return (
    <I18nProvider>
      <TRPCProvider>
        <div className="min-h-screen flex flex-col">
          <header className="bg-white border-b border-[#EDEDED] shrink-0">
            <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
              <Link href={`/careers/${orgSlug}`} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#1F114C] flex items-center justify-center text-white text-[11px] font-bold">
                  {org.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <span className="text-sm font-semibold text-[#1F114C]">{org.name}</span>
                  <p className="text-[10px] text-[#8B8B8B]">Careers</p>
                </div>
              </Link>
              <Link
                href="/login"
                className="h-8 px-4 rounded-lg border border-[#EDEDED] text-xs text-[#585858] font-medium hover:bg-[#F6F6F6] transition inline-flex items-center"
              >
                Sign In
              </Link>
            </div>
          </header>
          <main className="flex-1">{children}</main>
          <footer className="bg-white border-t border-[#EDEDED] py-6">
            <div className="max-w-5xl mx-auto px-6 text-center">
              <p className="text-xs text-[#8B8B8B]">Powered by TIMS ATS</p>
            </div>
          </footer>
        </div>
      </TRPCProvider>
    </I18nProvider>
  );
}
