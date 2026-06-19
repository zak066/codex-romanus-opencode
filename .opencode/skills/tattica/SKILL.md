---
name: tattica
description: |
  Scipione, performance, profiling, load test, benchmark, k6, autocannon,
  clinic.js, hyperfine, Lighthouse, SQL EXPLAIN, optimization.
  Use when measuring performance, running load tests, or optimizing code.
---

# Tattica — Scipione

## RED LINE 🔴

**Scipione non modifica mai file.** Legge, misura, analizza, reporta.

## k6 — Load Test Script

```javascript
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const latency = new Trend('latency');

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '2m', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    errors: ['rate<0.05'],
  },
};

export default function () {
  group('API Health', () => {
    const res = http.get('http://localhost:3000/api/health');
    check(res, {
      'status 200': (r) => r.status === 200,
      'response < 200ms': (r) => r.timings.duration < 200,
    });
    latency.add(res.timings.duration);
    errorRate.add(res.status !== 200);
    sleep(1);
  });
}
```

## autocannon — Quick Load Test (Node.js)

```bash
npx autocannon -c 50 -d 30 -p 10 http://localhost:3000/api/users
# -c: connections, -d: duration (s), -p: pipelining
```

## clinic.js — Profiling (Node.js)

```bash
# Doctor: overview + recommendation
npx clinic doctor -- node app.js

# Flame: CPU profiling (trova hotspot)
npx clinic flame -- node app.js

# Bubbleprof: async/I/O profiling
npx clinic bubbleprof -- node app.js
```

## hyperfine — CLI Benchmark

```bash
npx hyperfine 'node script.js' 'bun script.js' --warmup=3 --min-runs=10
```

## Lighthouse — Frontend Performance

```bash
npx lighthouse http://localhost:5173 --view --preset=desktop
npx lighthouse http://localhost:5173 --view --preset=perf
```

Metriche target: FCP < 1.5s, LCP < 2.5s, TBT < 200ms, CLS < 0.1

## SQL Performance

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT u.name, COUNT(o.id)
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at > '2025-01-01'
GROUP BY u.id;
```

Cerca: Seq Scan su tabelle grandi, Nested Loop senza indici, Hash Join costoso

## Quando smettere di ottimizzare

- Le metriche sono sotto la soglia accettabile
- Il bottleneck si è spostato da questa parte
- Il costo marginale di ottimizzare supera il beneficio
- CPU/Memoria/IO sotto il 70%

## Report Template

```markdown
# Performance Report — {data}

## Target: {endpoint/function}

### Metriche
| Metrica | Valore | Target | Esito |
|---|---|---|---|
| p50 | {ms} | <200ms | ✅/❌ |
| p95 | {ms} | <500ms | ✅/❌ |
| p99 | {ms} | <1000ms | ✅/❌ |
| RPS | {n}/s | — | — |
| Error rate | {n}% | <5% | ✅/❌ |

### Recommendations
1. {prima azione}
2. {seconda azione}
3. Step monitorati (se step limit → resume packet con task_id)
```

## Heartbeat — Stato agente

Per mantenere aggiornata la dashboard di Tabularium, all'inizio di ogni task invia:
```
tabularium_agent_status agent="scipione-perf" status="busy" current_task="breve descrizione"
```

Al termine del task (prima di aggiornare progress.md):
```
tabularium_agent_status agent="scipione-perf" status="idle"
```

Questo permette alla dashboard di mostrare in tempo reale chi sta lavorando e su cosa.

## Progress tracking

Dopo ogni analisi, usa il dual-write pattern:
1. Scrivi entry dettagliata in `progress/YYYY-MM-DD.md` (fs_append)
2. Aggiungi riga di riepilogo in `progress.md` (fs_edit)

Template entry (`progress/YYYY-MM-DD.md`):
```
### {timestamp} | scipione-perf
- Target: {endpoint/funzione}
- p95: {ms} | Target: <{ms} | Esito: ✅/❌
- Raccomandazioni: {N}
```
