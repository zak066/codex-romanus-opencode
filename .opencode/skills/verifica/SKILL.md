---
name: verifica
description: |
  Diana, testing, test, unit test, integration test, e2e, coverage,
  test pyramid, AAA pattern, mock, stub, jest, vitest, pytest.
  Use when writing tests, running test suites, or checking coverage.
---

# Verifica — Diana

## Test Pyramid

```
      ╱╲            E2E (10%)
     ╱  ╲           Flussi completi, UI, API
    ╱────╲
   ╱      ╲        Integration (20%)
  ╱────────╲       API, DB, servizi, middleware
 ╱          ╲
╱────────────╲     Unit (70%)
               Funzioni singole, moduli, utility
```

## AAA Pattern — Esempi concreti

```javascript
// Unit Test — funzione pura
describe('formatCurrency', () => {
  it('arrotonda a 2 decimali con simbolo euro', () => {
    // Arrange
    const amount = 1234.567;

    // Act
    const result = formatCurrency(amount, 'EUR');

    // Assert
    expect(result).toBe('€1,234.57');
  });
});

// Integration Test — API endpoint
describe('POST /api/users', () => {
  it('crea utente e restituisce 201', async () => {
    // Arrange
    const body = { name: 'Test', email: 'test@test.com' };

    // Act
    const res = await request(app).post('/api/users').send(body);

    // Assert
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Test');
  });
});

// Edge case test
describe('validateEmail', () => {
  it('rifutta email senza @', () => {
    expect(validateEmail('test')).toBe(false);
    expect(validateEmail('')).toBe(false);
    expect(validateEmail(null)).toBe(false);
    expect(validateEmail('test@test.com')).toBe(true);
  });
});
```

## Mock Strategy

```javascript
// Mock modulo esterno
jest.mock('axios', () => ({
  get: jest.fn().mockResolvedValue({ data: { id: 1 } }),
}));

// Mock funzione
const myMock = jest.fn()
  .mockReturnValue('default')
  .mockReturnValueOnce('first call')
  .mockReturnValueOnce('second call');

// Spy su esistente
const spy = jest.spyOn(service, 'method');
spy.mockImplementation(() => 'mocked');
```

**Regola d'oro**: mocka solo ciò che è esterno al tuo modulo (API, DB, FS).
Non mockare funzioni dello stesso modulo.

## Coverage Target

```bash
# Jest
npx jest --coverage --coverageThreshold='{"global":{"lines":80,"branches":75,"functions":80,"statements":80}}'

# Vitest
npx vitest run --coverage --coverage.thresholds.lines=80

# pytest
pytest --cov=. --cov-fail-under=80 --cov-report=term-missing
```

## Test Runner Commands

```bash
# Run all
npm test

# Run single file
npx jest src/auth.test.ts

# Watch mode (ri-esegue su change)
npm run test:watch

# Coverage
npm run test:coverage

# Specifica test
npx jest -t "login"
```

## Cosa testare

| Tipo | Cosa | Esempio |
|---|---|---|
| Unit | Funzioni pure, utility, validatori, trasformazioni | `formatDate()`, `validateEmail()` |
| Integration | API endpoint, middleware, DB queries | `POST /api/users`, `auth middleware` |
| E2E | Flusso utente completo | login → dashboard → logout |
| Regression | Bug fix specifici | Test che riproduce il bug risolto |

## Heartbeat — Stato agente

Per mantenere aggiornata la dashboard di Tabularium, all'inizio di ogni task invia:
```
tabularium_agent_status agent="diana-tester" status="busy" current_task="breve descrizione"
```

Al termine del task (prima di aggiornare progress.md):
```
tabularium_agent_status agent="diana-tester" status="idle"
```

Questo permette alla dashboard di mostrare in tempo reale chi sta lavorando e su cosa.

## Progress tracking

Dopo ogni test run, usa il dual-write pattern:
1. Scrivi entry dettagliata in `progress/YYYY-MM-DD.md` (fs_append)
2. Aggiungi riga di riepilogo in `progress.md` (fs_edit)

Template entry (`progress/YYYY-MM-DD.md`):
```
### {timestamp} | diana-tester
- Test scritti: {N} nuovi
- Coverage: lines {N}% / branches {N}%
- Esito: ✅ {passati} / ❌ {falliti}
- Step monitorati: [✅/⚠️] (se step limit → resume packet con task_id)
