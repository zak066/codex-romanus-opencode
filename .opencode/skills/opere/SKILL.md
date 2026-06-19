---
name: opere
description: |
  Agrippa, DevOps, CI/CD, Docker, container, Kubernetes, Terraform,
  deploy, environment, rollback, GitHub Actions, GitLab CI.
  Use when setting up infrastructure, pipelines, or deploying.
---

# Opere — Agrippa

## Dockerfile Best Practice (Node.js)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
CMD ["node", "dist/index.js"]
```

```bash
docker build -t myapp:latest .
docker run -d -p 3000:3000 --restart unless-stopped myapp:latest
```

## .dockerignore

```
node_modules
.git
*.md
dist/
.env
```

## CI/CD — GitHub Actions

```yaml
name: CI
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci && npm run lint
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci && npm test && npm run test:coverage
  deploy:
    needs: [lint, test]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "Deploy a ${{ vars.ENVIRONMENT }}"
```

## Deploy Strategy

| Strategy | Downtime | Rollback | Uso |
|---|---|---|---|
| Blue-Green | Zero | Istantaneo | Produzione critica |
| Rolling | Minimo | Graduale | Standard |
| Canary | Zero | Istantaneo | Test su % traffico |

## Rollback Procedure

```bash
# Git revert
git revert HEAD --no-edit
git push origin main

# Docker rollback
docker stop myapp-new
docker start myapp-old

# Terraform rollback
terraform plan -destroy
terraform apply -destroy
```

## Environment Config

- `.env.development` — locale, committato con valori dummy
- `.env.staging` — staging, gestito via CI/CD secrets
- `.env.production` — mai in repo, gestito via vault/secrets manager
- Usa secret manager: GitHub Secrets, AWS Secrets Manager, HashiCorp Vault

## Terraform (basics)

```hcl
resource "aws_ecs_service" "app" {
  name            = "myapp-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 2
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
}
```

## Heartbeat — Stato agente

Per mantenere aggiornata la dashboard di Tabularium, all'inizio di ogni task invia:
```
tabularium_agent_status agent="agrippa-devops" status="busy" current_task="breve descrizione"
```

Al termine del task (prima di aggiornare progress.md):
```
tabularium_agent_status agent="agrippa-devops" status="idle"
```

Questo permette alla dashboard di mostrare in tempo reale chi sta lavorando e su cosa.

## Progress tracking

Dopo ogni operazione, usa il dual-write pattern:
1. Scrivi entry dettagliata in `progress/YYYY-MM-DD.md` (fs_append)
2. Aggiungi riga di riepilogo in `progress.md` (fs_edit)

Template entry (`progress/YYYY-MM-DD.md`):
```
### {timestamp} | agrippa-devops
- Operazione: {deploy/setup/rollback}
- Ambiente: {dev/staging/prod}
- Stato: ✅ / ❌
- Step monitorati: [✅/⚠️] (se step limit → resume packet con task_id)
```
