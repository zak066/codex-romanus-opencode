---
name: censura
description: |
  Catone, quality, tooling, lint, ESLint, Prettier, husky, lint-staged,
  semantic versioning, release, GitHub release, quality gate, code style
  enforcement. Use when setting up tooling, releasing, or enforcing quality.
---

# Censura — Catone

## Lint Setup (Node.js)

```bash
# ESLint + Prettier install
npm install -D eslint prettier eslint-config-prettier eslint-plugin-prettier

# Config .eslintrc.json
{
  "extends": ["eslint:recommended", "prettier"],
  "parserOptions": { "ecmaVersion": "latest", "sourceType": "module" },
  "rules": {
    "no-unused-vars": "warn",
    "no-console": "warn",
    "prefer-const": "error"
  }
}

# .prettierrc
{
  "singleQuote": true, "trailingComma": "all", "semi": true, "tabWidth": 2
}
```

Per Python: `pip install ruff` → `ruff check .`
Per Go: `gofmt -l .` + `golangci-lint run`
Per Rust: `cargo clippy`

## Pre-commit con Husky (Node.js)

```bash
npx husky init
echo "npx lint-staged" > .husky/pre-commit
```

```json
{
  "lint-staged": {
    "*.{js,ts,jsx,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,yaml,css}": ["prettier --write"]
  }
}
```

## Quality Gate — Carthago Delenda Est

| Gate | Fail |
|---|---|
| ESLint/Prettier | ❌ |
| Tests | ❌ |
| Coverage < 80% | ❌ |
| Vulnerability critical | ❌ |

## Semantic Versioning

| Cambiamento | Tipo | Esempio |
|---|---|---|
| Breaking change API | MAJOR | 1.0.0 → 2.0.0 |
| Nuova feature (non-breaking) | MINOR | 1.0.0 → 1.1.0 |
| Bug fix (non-breaking) | PATCH | 1.0.0 → 1.0.1 |

```bash
npm version patch -m "release: v%s"
npm version minor -m "release: v%s"
npm version major -m "release: v%s"
```

## Release Workflow

1. `git checkout main && git pull`
2. `npm version {patch|minor|major} -m "release: v%s"`
3. `npm run build` (se applicabile)
4. `gh release create v{version} --generate-notes`
5. `git push origin main --tags`

Per altri stack: `git tag -a v{version} -m "release: v{version}" && git push origin v{version}`

## Config commitlint (optional)

```bash
npm install -D @commitlint/cli @commitlint/config-conventional
echo "export default { extends: ['@commitlint/config-conventional'] }" > commitlint.config.js
```

Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`

## Heartbeat — Stato agente

Per mantenere aggiornata la dashboard di Tabularium, all'inizio di ogni task invia:
```
tabularium_agent_status agent="catone-quality" status="busy" current_task="breve descrizione"
```

Al termine del task (prima di aggiornare progress.md):
```
tabularium_agent_status agent="catone-quality" status="idle"
```

Questo permette alla dashboard di mostrare in tempo reale chi sta lavorando e su cosa.

## Progress tracking

Dopo ogni step, usa il dual-write pattern:
1. Scrivi entry dettagliata in `progress/YYYY-MM-DD.md` (fs_append)
2. Aggiungi riga di riepilogo in `progress.md` (fs_edit)

Template entry (`progress/YYYY-MM-DD.md`):
```
### {timestamp} | catone-quality
- Fatto: {descrizione}
- Comandi usati: {comandi}
- Step monitorati: [✅/⚠️] (se step limit → resume packet con task_id)
```
