'use client';

// Root error boundary. Renders when an error escapes the app's nested layouts,
// so it must provide its own <html>/<body> and cannot rely on app CSS being
// loaded — hence minimal inline styles (the one place this is idiomatic).
// Reports the error to Sentry (no-ops when no DSN is configured).
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#F6F6F6', color: '#333' }}>
        <div style={{ maxWidth: 420, margin: '15vh auto', padding: 24, textAlign: 'center' }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Algo salió mal</h2>
          <p style={{ color: '#666', marginBottom: 20 }}>
            Ocurrió un error inesperado. Intenta de nuevo.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              background: '#111',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
