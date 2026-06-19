# Ianus Retention — Retention Policy Script for Codex Romanus

Implements **ADR-032** — lifecycle management for backups, metrics, session events, and temporary artifacts across the Codex Romanus ecosystem.

## Quick Start

```powershell
# Preview what would be cleaned (safe — dry-run by default)
.\scripts\retention.ps1

# Apply retention policy
.\scripts\retention.ps1 -Execute -Force
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `-Execute` | switch | `$false` | Apply changes (default: dry-run only) |
| `-Force` | switch | `$false` | Skip interactive confirmation prompt |
| `-Area` | string | all areas | Filter: `ianus_backups`, `tabularium_metrics`, `tabularium_sessions`, `tabularium_artifacts` |
| `-ConfigPath` | string | `../retention.config.json` | Path to retention configuration file |
| `-AuditLog` | string | `./ianus-retention-audit.log` | Path to audit log file |

## Areas

### 1. `ianus_backups` — Ianus Liminalis Backup Snapshots

Scans `.ianus-backups/` for backup directories and manages their lifecycle:

- **Compress** after 7 days: directories are archived into `.tar.gz` files
- **Delete** after 30 days: old backups are removed
- **Safeguard**: never deletes the most recent backup (even if >30d old)
- Compression uses `tar` (built-in on Windows 10/11+ and PowerShell 7+)

### 2. `tabularium_metrics` — Tabularium Metrics Time-Series

Purges old metric records from `tabularium/memory.db`:

- **Purge after** 180 days: metric records older than this threshold
- **Archive before purge**: exports old records to JSON in `tabularium/backups/`
- Uses `sqlite3` CLI for database operations
- Falls back gracefully if sqlite3 is not available

### 3. `tabularium_sessions` — Tabularium Session Events

Archives and removes old session lifecycle events from `tabularium/memory.db`:

- **Archive after** 90 days: session events (started/ended) are exported to JSON
- **Delete after archive**: removes archived events from the database
- Uses `sqlite3` CLI

### 4. `tabularium_artifacts` — Temporary Files

Cleans up transient files in `tabularium/`:

| Pattern | Max Age | Description |
|---------|---------|-------------|
| `eslint-output*.json` | 1 day | ESLint quality gate output |
| `eslint-errors*.json` | 1 day | ESLint error breakdown |
| `*.log` | 7 days | Log files |
| `memory_*.db` | 30 days | Transient DB dumps (excludes live DB files) |
| `memory.db-wal.bak` | 0 days | Stale WAL backups (immediate cleanup) |

## Output Colors

| Color | Meaning |
|-------|---------|
| Cyan | Area headers and script banner |
| Green | Successful actions |
| Yellow | Dry-run mode and warnings |
| Red | Errors |
| Gray | Informational messages |

## Audit Log

Every action is recorded in `ianus-retention-audit.log` in the format:

```
[TIMESTAMP] [AREA] [ACTION] path -> status
```

Example:
```
[2026-05-30T13:00:00Z] [tabularium_artifacts] [DELETE] eslint-output-1745910476057.json -> success
[2026-05-30T13:00:01Z] [ianus_backups] [COMPRESS] .ianus-backups/abc123/ -> success
```

## CI/CD Integration

### Scheduled Task (Windows)

```powershell
# Run daily at 2 AM
schtasks /create /tn "CodexRomanus-Retention" /tr "powershell -NoProfile -File C:\codex-romanus\scripts\retention.ps1 -Execute -Force" /sc daily /st 02:00
```

### GitHub Actions (Weekly)

```yaml
name: Retention Policy
on:
  schedule:
    - cron: '0 6 * * 1'  # Every Monday at 6 AM UTC
jobs:
  retention:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run retention policy
        shell: pwsh
        run: ./scripts/retention.ps1 -Execute -Force
```

### PowerShell Pipeline

```powershell
.\scripts\retention.ps1 -Execute -Force -AuditLog 'C:\logs\retention.log'
```

## Examples

### Dry-run for a single area
```powershell
.\scripts\retention.ps1 -Area ianus_backups
```

### Execute with custom config
```powershell
.\scripts\retention.ps1 -Execute -Force -ConfigPath '..\custom-retention.json'
```

### Check only artifacts
```powershell
.\scripts\retention.ps1 -Area tabularium_artifacts -Execute -Force
```

## Prerequisites

| Requirement | Version | Notes |
|------------|---------|-------|
| PowerShell | 7+ | Uses `-AsHashtable`, `Switch` statement features |
| `tar` | any | Built-in on Windows 10 1803+ / PowerShell 7+ |
| `sqlite3` CLI | any | For DB operations. Install via `choco install sqlite` or from [sqlite.org](https://sqlite.org/download.html) |

### Installing sqlite3

```powershell
# Chocolatey (recommended)
choco install sqlite

# Or download manually from https://sqlite.org/download.html
# Add sqlite3.exe to your PATH
```

## Safety

- **Dry-run by default**: always preview before destructive operations
- **Safe guard**: the `safeguard_min_backups` setting prevents deletion of all backups
- **Archive before purge**: metrics and session data are backed up before deletion
- **Audit trail**: all actions are logged for traceability
- **Non-interactive**: `-Force` flag enables fully automated execution

## Configuration Reference

See [`retention.config.json`](../retention.config.json) for the full configuration schema.

Key settings:

| Setting | Description |
|---------|-------------|
| `compress_after_days` | Age at which backups are compressed (default: 7) |
| `delete_after_days` | Age at which backups/artifacts are deleted (default: 30) |
| `safeguard_min_backups` | Minimum number of backups to retain (default: 1) |
| `purge_after_days` | Age at which metrics records are purged (default: 180) |
| `archive_before_purge` | Export records to JSON before deletion (default: true) |
| `max_age_days` | Per-pattern artifact retention threshold |

## Tags

#retention #ianus-liminalis #tabularium #adr-032 #powershell #devops
