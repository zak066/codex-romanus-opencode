'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          fontFamily: 'system-ui, sans-serif',
          padding: '2rem',
          textAlign: 'center',
        }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '1rem', color: '#dc2626' }}>
            Errore del sistema
          </h1>
          <p style={{ marginBottom: '0.5rem', color: '#6b7280' }}>
            Si è verificato un errore imprevisto.
          </p>
          {error.digest && (
            <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '1.5rem' }}>
              ID errore: {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            Riprova
          </button>
        </div>
      </body>
    </html>
  );
}
