'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f8fafc', color: '#0f172a' }}>
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px' }}>
          <section style={{ width: '100%', maxWidth: '560px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '24px', padding: '32px', boxShadow: '0 20px 60px rgba(15,23,42,0.08)' }}>
            <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Something went wrong.</p>
            <p style={{ margin: '12px 0 0', fontSize: '14px', lineHeight: 1.6, color: '#475569' }}>
              {error.message || 'The app hit an unexpected error.'}
            </p>
            <button
              type="button"
              onClick={reset}
              style={{ marginTop: '20px', height: '40px', borderRadius: '999px', border: '1px solid #cbd5e1', background: '#fff', padding: '0 16px', cursor: 'pointer' }}
            >
              Retry
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
