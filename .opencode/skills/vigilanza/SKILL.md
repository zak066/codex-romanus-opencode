---
name: vigilanza
description: |
  Janus, security, audit, vulnerability scanning, OWASP, dependency check,
  secret detection, semgrep, trufflehog, snyk, code security review.
  Use when auditing code security, scanning dependencies, or reviewing auth.
---

# Vigilanza — Janus

## RED LINE 🔴

**Janus NON modifica mai file.** Legge, analizza, produce report.
Mai editare codice sorgente, configurazioni o file di progetto.

## Scan Commands (Node.js)

```bash
# Dipendenze
npm audit --audit-level=high
npm audit --production

# Semgrep — code analysis
npx semgrep --config=auto .
npx semgrep --config=p/owasp-top-ten .
npx semgrep --config=p/javascript-owasp .

# TruffleHog — secrets
npx trufflehog filesystem . --no-verification --exclude-paths=.gitignore

# Snyk
npx snyk test
npx snyk code test
```

Per Python: `pip-audit` / `bandit -r .`
Per Go: `gosec ./...`
Per Rust: `cargo audit`

## OWASP Top 10 — Versione concisa

| # | Categoria | Cosa controllare |
|---|---|---|
| A01 | Broken Access Control | Permessi su ogni rotta, no IDOR |
| A02 | Crypto Failures | No dati in chiaro, HTTPS, hashing password |
| A03 | Injection | Query parametrizzate, input sanitized, no eval |
| A04 | Insecure Design | Rate limiting, validation server-side |
| A05 | Security Misconfig | No default creds, CORS stretto, headers security |
| A06 | Vulnerable Components | Dipendenze aggiornate, CVE check |
| A07 | Auth Failures | JWT validato, sessioni sicure, 2FA |
| A08 | Data Integrity | CSP, signed payloads |
| A09 | Logging Fail | No log di dati sensibili |
| A10 | SSRF | No fetch a URL non validate |

## Secret Detection Pattern

```regex
(?i)(api[_-]?key|secret|password|token|credential|private[_-]?key)
```

Cerca in: tutti i file tranne `.git/`, `node_modules/`, `.env` (ma segnala se .env in repo)

## Severità Classification

| Livello | Esempi | Azione |
|---|---|---|
| CRITICAL | Remote code execution, secret esposto, SQL injection | Blocco immediato |
| HIGH | XSS, auth bypass, broken access control | Fix nella sessione |
| MEDIUM | Misconfig, CSP mancante, header security | Fix in sprint |
| LOW | Best practice warning | Note per prossimo refactor |

## Auth/Authorization Review Checklist

- [ ] Password hashing (bcrypt/argon2, non SHA/MD5)
- [ ] JWT: signature verificata, expiry ragionevole, no secret in payload
- [ ] Rate limiting su login/register
- [ ] Ogni rotta protetta controlla permessi
- [ ] No hardcoded credenziali
- [ ] Sessioni: HTTP-only cookie, secure flag, SameSite

## Report Template

```markdown
# Security Audit Report — {data}

## Critical ({N})
| File | Linea | Issue | Remediation |
|---|---|---|---|

## High ({N})
...

## Medium ({N})
...

## Recommendations
- [ ] {azione prioritaria}
- [ ] {azione secondaria}
- [ ] Step monitorati (se step limit → resume packet con task_id)
```

## Heartbeat — Stato agente

Per mantenere aggiornata la dashboard di Tabularium, all'inizio di ogni task invia:
```
tabularium_agent_status agent="janus-security" status="busy" current_task="breve descrizione"
```

Al termine del task (prima di aggiornare progress.md):
```
tabularium_agent_status agent="janus-security" status="idle"
```

Questo permette alla dashboard di mostrare in tempo reale chi sta lavorando e su cosa.

## Progress tracking

Dopo ogni audit, usa il dual-write pattern:
1. Scrivi entry dettagliata in `progress/YYYY-MM-DD.md` (fs_append)
2. Aggiungi riga di riepilogo in `progress.md` (fs_edit)

Template entry (`progress/YYYY-MM-DD.md`):
```
### {timestamp} | janus-security
- Scope audit: {descrizione}
- Trovato: {N} critici, {N} high, {N} medium
- Totale file scansionati: {N}
