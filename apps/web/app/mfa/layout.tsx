import { I18nProvider } from '../../lib/i18n';

// Standalone layout for the two-factor flow. Lives OUTSIDE the (admin) group so the
// MFA enforcement gate in (admin)/layout.tsx can redirect here without looping.
// Brings its own I18nProvider (the app's provider is mounted inside the admin shell).
export default function MfaLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <div className="flex min-h-screen items-center justify-center bg-[#F6F6F6] px-4 py-10">
        {children}
      </div>
    </I18nProvider>
  );
}
