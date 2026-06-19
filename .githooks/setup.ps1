#!/usr/bin/env pwsh
# setup.ps1 — Codex Romanus Git hooks installer
# Esegui questo script dopo ogni clone per attivare i pre-push hook

$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) {
    Write-Host "❌ Non sei in un repository Git"
    exit 1
}

Write-Host "🔧 Codex Romanus — Installazione Git hooks..."
git config core.hooksPath .githooks
Write-Host "✅ core.hooksPath = .githooks"

Write-Host ""
Write-Host "📋 Hook installati:"
Get-ChildItem -Path "$repoRoot\.githooks" -File | ForEach-Object {
    Write-Host "  • $($_.Name)"
}

Write-Host ""
Write-Host "🚀 Pronto. I pre-push hook sono attivi."
