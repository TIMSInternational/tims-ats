'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { Button } from '../../components/button';

// The QR and its manual key. On a phone the key is the only way to finish setup (the QR is on the same
// screen), so below sm it comes first, grouped in fours and copyable (entering-data.md › Best practices:
// "let people provide data … by pasting it").
export function MfaEnrollSecret({ qr, secret }: { qr: string; secret: string | null }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Supabase returns the QR as an SVG data URI — render directly. */}
      <img src={qr} alt={t.mfa.qrAlt} className="size-44 rounded-xl border border-border" />
      {secret && (
        <div className="w-full max-sm:order-first">
          <p className="mb-1.5 text-callout text-secondary">{t.mfa.secretLabel}</p>
          <div className="flex items-center gap-2">
            <code
              aria-label={t.mfa.secretGroupsLabel}
              className="block min-w-0 flex-1 rounded-lg bg-surface px-3 py-2 text-center font-mono text-body tracking-wider text-primary tabular-nums break-all"
            >
              {secret.match(/.{1,4}/g)?.join(' ')}
            </code>
            <Button variant="secondary" size="sm" onClick={() => void copy()}>
              <span aria-live="polite">{copied ? t.common.copied : t.common.copy}</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
