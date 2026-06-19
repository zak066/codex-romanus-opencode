<#
  Codex Romanus — Setup Automatico
  Installa e builda tutti i componenti del progetto nell'ordine corretto.

.DESCRIPTION
  Automatizza npm install e npm run build per ogni componente di Codex Romanus:
    packages/fs-backup → ianus-liminalis → tabularium → speculum → praetorium → imago → nuntius.
  L'ordine tiene conto delle dipendenze (fs-backup DEVE essere buildato prima
  di installare ianus-liminalis).

.PARAMETER SkipBuild
  Salta npm run build per tutti i componenti (solo npm install).

.PARAMETER Component
  Se specificato, installa/builda SOLO questo componente (es. "ianus-liminalis").
  Accetta sia il nome breve che il path completo (es. "fs-backup" o "packages/fs-backup").

.EXAMPLE
  .\setup-codex.ps1                        # Completo: install + build
  .\setup-codex.ps1 -SkipBuild             # Solo npm install
  .\setup-codex.ps1 -Component ianus-liminalis  # Solo ianus


.NOTES
  Compatibile con PowerShell 5.1+ (Windows).
  Coerente con reset-codex.ps1 per stile e convenzioni.
#>

param(
  [Parameter(Mandatory = $false)]
  [switch]$SkipBuild,

  [Parameter(Mandatory = $false)]
  [string]$Component
)

# -------------------------------------------------
#  CONFIG - Componenti in ordine di installazione
# -------------------------------------------------

$components = @(
  @{
    Name        = "packages/fs-backup"
    Alias       = "fs-backup"
    HasBuild    = $true
    BuildCmd    = "run build"
    Critical    = $true        # Se fallisce, ferma tutto
  }
  @{
    Name        = "ianus-liminalis"
    Alias       = "ianus"
    HasBuild    = $true
    BuildCmd    = "run build"
    Critical    = $false
  }
  @{
    Name        = "tabularium"
    Alias       = "tabularium"
    HasBuild    = $true         # main: dist/server.js — build necessaria
    BuildCmd    = "run build"
    Critical    = $false
  }
  @{
    Name        = "speculum"
    Alias       = "speculum"
    HasBuild    = $true
    BuildCmd    = "run build"
    Critical    = $false
  }
  @{
    Name        = "praetorium"
    Alias       = "praetorium"
    HasBuild    = $true         # Next.js — build necessaria per produzione
    BuildCmd    = $null
    Critical    = $false
  }
  @{
    Name        = "imago"
    Alias       = "imago"
    HasBuild    = $true
    BuildCmd    = "run build"
    Critical    = $false
  }
  @{
    Name        = "nuntius"
    Alias       = "nuntius"
    HasBuild    = $true
    BuildCmd    = "run build"
    Critical    = $false
  }
)

# -------------------------------------------------
#  FUNZIONI DI SUPPORTO
# -------------------------------------------------

function Write-Header {
  param([string]$Text)
  Write-Host "`n==========================================" -ForegroundColor Cyan
  Write-Host " $Text" -ForegroundColor Cyan
  Write-Host "==========================================" -ForegroundColor Cyan
}

function Invoke-NpmCommand {
  param(
    [string]$ComponentDir,
    [string]$Label,
    [string]$NpmArgs
  )

  Write-Host "  $Label..." -NoNewline

  # Tieni traccia del codice di uscita con $LASTEXITCODE
  $sw = [System.Diagnostics.Stopwatch]::StartNew()

  # Pulizia node_modules PRIMA di npm install
  $nodeModulesPath = Join-Path -Path $ComponentDir -ChildPath "node_modules"
  if ($NpmArgs -eq "install" -and (Test-Path -LiteralPath $nodeModulesPath)) {
    Remove-Item -LiteralPath $nodeModulesPath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "" 
    Write-Host "  Pulizia node_modules... OK" -ForegroundColor Green
    Write-Host "  $Label..." -NoNewline
  }

  # Esegui npm in una subshell così $LASTEXITCODE è affidabile
  $output = & cmd /c "cd /d `"$ComponentDir`" && npm $NpmArgs 2>&1"
  $exitCode = $LASTEXITCODE
  $sw.Stop()

  $elapsed = "{0:N1}" -f $sw.Elapsed.TotalSeconds

  if ($exitCode -eq 0) {
    Write-Host " ✅ ($($elapsed)s)" -ForegroundColor Green
    return $true
  } else {
    Write-Host " ❌ ($($elapsed)s)" -ForegroundColor Red
    # Mostra le ultime righe di output per debug
    if ($output) {
      $lines = $output -split "`r`n" | Where-Object { $_ -ne "" }
      $tail = $lines[-3..-1] -join "`n  "
      if ($tail) {
        Write-Host "  └─ Ultimo output: $tail" -ForegroundColor DarkGray
      }
    }
    return $false
  }
}

function Format-Emoji {
  param([bool]$Success)
  if ($Success) { return "✅" } else { return "❌" }
}

function Format-Check {
  param(
    [bool]$Success,
    [string]$Fallback = "⏭️"
  )
  if ($null -eq $Success) { return "⏭️ $Fallback" }
  if ($Success) { return "✅" } else { return "❌" }
}

# -------------------------------------------------
#  INIZIO
# -------------------------------------------------

Clear-Host
Write-Header "Codex Romanus — Setup Automatico"
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "  PowerShell $($PSVersionTable.PSVersion)"

# --- Node.js version check ---
$nodeVersion = $null
try {
  $nodeVersionOutput = & cmd /c "node --version 2>&1"
  if ($LASTEXITCODE -eq 0) {
    $nodeVersion = $nodeVersionOutput.Trim() -replace '^v', ''
  }
} catch {}

if (-not $nodeVersion) {
  Write-Host "`n❌ Node.js non trovato. Installa Node.js 18+ da https://nodejs.org/" -ForegroundColor Red
  exit 1
}

$nodeMajor = [int]($nodeVersion -split '\.' | Select-Object -First 1)
if ($nodeMajor -lt 18) {
  Write-Host "`n❌ Node.js v$nodeVersion rilevato. Serve versione 18+. Aggiorna da https://nodejs.org/" -ForegroundColor Red
  exit 1
}

Write-Host "  Node.js v$nodeVersion rilevato" -ForegroundColor Green
# --- Fine Node.js version check ---

if ($SkipBuild)   { Write-Host "  Modalità: solo install (build saltato)" -ForegroundColor Yellow }
if ($Component)   { Write-Host "  Componente: $Component" -ForegroundColor Yellow }
Write-Host ""

# Converti Component in alias o nome per matching flessibile
$filterComponent = if ($Component) { $Component.Trim().ToLower() } else { $null }

# -------------------------------------------------
#  ESECUZIONE
# -------------------------------------------------

$results = @()  # Array per il riepilogo finale
$totalSteps = 0
$currentStep = 0

# Conta gli step effettivi (solo quelli che verranno eseguiti)
# per numerare correttamente l'output
$effectiveComponents = $components | Where-Object {
  if (-not $filterComponent) { return $true }
  $name = $_.Name.ToLower()
  $alias = $_.Alias.ToLower()
  ($name -eq $filterComponent) -or ($alias -eq $filterComponent)
}
$totalSteps = $effectiveComponents.Count

foreach ($comp in $components) {
  $compName = $comp.Name
  $compAlias = $comp.Alias
  $compDir = Join-Path -Path $PSScriptRoot -ChildPath $compName

  # --- Filtro Component ---
  if ($filterComponent) {
    $nameLower = $compName.ToLower()
    $aliasLower = $compAlias.ToLower()
    if (($nameLower -ne $filterComponent) -and ($aliasLower -ne $filterComponent)) {
      continue
    }
  }

  $currentStep++
  $stepLabel = "[$currentStep/$totalSteps]"

  # --- Verifica esistenza directory ---
  if (-not (Test-Path -LiteralPath $compDir -PathType Container)) {
    Write-Host "$stepLabel $compName —" -NoNewline
    Write-Host " directory non trovata, skip" -ForegroundColor DarkGray
    $results += [PSCustomObject]@{
      Component = $compName
      Install   = $null
      Build     = $null
      Note      = "directory mancante"
    }
    continue
  }

  # --- Verifica package.json ---
  $pkgPath = Join-Path -Path $compDir -ChildPath "package.json"
  if (-not (Test-Path -LiteralPath $pkgPath)) {
    Write-Host "$stepLabel $compName —" -NoNewline
    Write-Host " package.json non trovato, skip" -ForegroundColor DarkGray
    $results += [PSCustomObject]@{
      Component = $compName
      Install   = $null
      Build     = $null
      Note      = "package.json mancante"
    }
    continue
  }

  Write-Host ""
  Write-Host "$stepLabel $compName —" -ForegroundColor White

  # --- npm install ---
  $installOk = Invoke-NpmCommand -ComponentDir $compDir -Label "  npm install" -NpmArgs "install"

  if (-not $installOk) {
    # Se l'install fallisce, segna tutto come fallito e continua (non critico)
    Write-Host "  └─ ATTENZIONE: npm install fallito" -ForegroundColor Yellow
  }

  # --- npm run build (se previsto) ---
  $buildOk = $null
  if ($comp.HasBuild -and (-not $SkipBuild)) {
    $buildOk = Invoke-NpmCommand -ComponentDir $compDir -Label "  npm run build" -NpmArgs "run build"

    if (-not $buildOk) {
      if ($comp.Critical) {
        # Componente critico (fs-backup) — ferma tutto
        Write-Host "`n  ❌❌❌ BUILD FALLITO — $compName è critico. Arresto." -ForegroundColor Red
        $results += [PSCustomObject]@{
          Component = $compName
          Install   = $installOk
          Build     = $buildOk
          Note      = "BUILD FALLITO (critico)"
        }
        # Mostra riepilogo parziale
        Write-Host ""
        Write-Header "Riepilogo parziale (build interrotta)"
        foreach ($r in $results) {
          $n = $r.Component.PadRight(24)
          $is = if ($r.Install -eq $true)  { "✅ install" } elseif ($r.Install -eq $false) { "❌ install" } else { "⏭️" }
          $bs = if ($r.Build -eq $true)    { "✅ build" }   elseif ($r.Build -eq $false)   { "❌ build" }   else { "⏭️" }
          $cl = if ($r.Install -eq $false -or $r.Build -eq $false) { "Red" } elseif ($r.Install -eq $true -or $r.Build -eq $true) { "Green" } else { "Gray" }
          Write-Host "  $n $is $bs" -ForegroundColor $cl
        }
        Write-Host "==========================================" -ForegroundColor Cyan
        exit 1
      } else {
        Write-Host "  └─ ATTENZIONE: build fallito, ma continuo lo stesso" -ForegroundColor Yellow
      }
    }
  } elseif ($SkipBuild) {
    $buildOk = $null  # skipped intenzionalmente
  } else {
    $buildOk = $null  # componente senza build
  }

  # --- Salva risultato ---
  $note = ""
  if ($installOk -eq $false)  { $note = "npm install fallito" }
  elseif ($buildOk -eq $false) { $note = "npm build fallito" }
  elseif ($SkipBuild -and $comp.HasBuild) { $note = "build saltato (-SkipBuild)" }

  $results += [PSCustomObject]@{
    Component = $compName
    Install   = $installOk
    Build     = $buildOk
    Note      = $note
  }
}

# -------------------------------------------------
#  RIEPILOGO FINALE
# -------------------------------------------------

Write-Host ""
Write-Header "Riepilogo"

foreach ($r in $results) {
  $compName = $r.Component.PadRight(24)

  $installStr = if ($r.Install -eq $true)  { "✅ install" }
                elseif ($r.Install -eq $false) { "❌ install" }
                else { "⏭️" }

  $buildStr = if ($r.Build -eq $true)  { "✅ build" }
              elseif ($r.Build -eq $false) { "❌ build" }
              else { "⏭️" }

  $noteStr = ""
  if ($r.Note) { $noteStr = " ($($r.Note))" }

  $lineColor = "Gray"
  if ($r.Install -eq $false -or $r.Build -eq $false) { $lineColor = "Red" }
  elseif ($r.Install -eq $true -or $r.Build -eq $true) { $lineColor = "Green" }

  Write-Host "  $compName $installStr $buildStr$noteStr" -ForegroundColor $lineColor
}

Write-Host "==========================================" -ForegroundColor Cyan

# --- Verifica errori ---
$errors = $results | Where-Object { $_.Install -eq $false -or $_.Build -eq $false }
if ($errors.Count -gt 0) {
  Write-Host "`n⚠️  $($errors.Count) componente/i con errori." -ForegroundColor Yellow
  Write-Host "   Controlla i log sopra per i dettagli." -ForegroundColor Yellow
  exit 1
} else {
  Write-Host "`n✅ Setup completato con successo!" -ForegroundColor Green
  Write-Host "   Codex Romanus è pronto all'uso." -ForegroundColor Green
  exit 0
}