import { TRPCProvider } from '../../lib/trpc-provider';
import { I18nProvider } from '../../lib/i18n';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <TRPCProvider>
        <div className="min-h-screen bg-[#F6F6F6]">
          {children}
        </div>
      </TRPCProvider>
    </I18nProvider>
  );
}
