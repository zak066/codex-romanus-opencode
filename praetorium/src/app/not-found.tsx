export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
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
      <h1 style={{ fontSize: '4rem', fontWeight: 'bold', margin: '0 0 0.5rem', color: '#6b7280' }}>
        404
      </h1>
      <h2 style={{ fontSize: '1.5rem', marginBottom: '0.75rem', color: '#111827' }}>
        Pagina non trovata
      </h2>
      <p style={{ marginBottom: '1.5rem', color: '#6b7280' }}>
        La risorsa che stai cercando non è disponibile.
      </p>
      <a
        href="/"
        style={{
          padding: '0.75rem 1.5rem',
          backgroundColor: '#2563eb',
          color: 'white',
          border: 'none',
          borderRadius: '0.5rem',
          cursor: 'pointer',
          fontSize: '1rem',
          textDecoration: 'none',
        }}
      >
        Torna alla home
      </a>
    </div>
  );
}
