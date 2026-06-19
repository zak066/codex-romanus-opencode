<#
.SYNOPSIS
    Retention policy enforcement for the Codex Romanus ecosystem.
    Manages lifecycle of backups, metrics, sessions, and temporary artifacts.

.DESCRIPTION
    Implements ADR-032 retention policy across 4 areas:
      1. ianus_backups     — Ianus Liminalis backup snapshots
      2.  tabularium_metrics  — Tabularium metrics time-series data
      3.  tabularium_sessions — Tabularium session events
      4.  tabularium_artifacts — Temporary build/ESLint/DB artifacts

    Default mode is DRY-RUN: shows what would happen without making changes.
    Use -Execute to apply the retention policy.

.PARAMETER Execute
    Apply retention actions (default: dry-run, no destructive operations).

.PARAMETER Force
    Skip interactive confirmations. Only meaningful with -Execute.

.PARAMETER Area
    Filter retention to a specific area. Valid values:
    ianus_backups, tabularium_metrics, tabularium_sessions, tabularium_artifacts

.PARAMETER ConfigPath
    Path to retention.config.json. Default: ../retention.config.json (relative to script)

.PARAMETER AuditLog
    Path to audit log file. Default: ../scripts/ianus-retention-audit.log (relative to script)

.EXAMPLE
    # Dry-run: preview what would be cleaned
    .\ianus-retention.ps1

.EXAMPLE
    # Execute retention for all areas (non-interactive)
    .\ianus-retention.ps1 -Execute -Force

.EXAMPLE
    # Dry-run for backups only
    .\ianus-retention.ps1 -Area ianus_backups

.EXAMPLE
    # Execute for artifacts only with custom config
    .\ianus-retention.ps1 -Execute -Area tabularium_artifacts -ConfigPath ..\custom-config.json

.NOTES
    Author:  Vulcanus / Codex Romanus Team
    Version: 1.0.0
    Requires: PowerShell 7+, sqlite3 CLI (for Tabularium DB operations)
#>

#requires -Version 7

param(
    [switch]$Execute,
    [switch]$Force,
    [ValidateSet('ianus_backups', 'tabularium_metrics', 'tabularium_sessions', 'tabularium_artifacts')]
    [string]$Area,
    [string]$ConfigPath,
    [string]$AuditLog
)

# ──────────────────────────────────────────
# Constants and Initialization
# ──────────────────────────────────────────
$ScriptName = 'retention.ps1'
$ScriptVersion = '1.0.0'
$ConfigFileRegex = 'retention\.config\.json$'

# Resolve paths
$ScriptDir = Split-Path -Parent $PSCommandPath
if (-not $ConfigPath) { $ConfigPath = Join-Path -Path $ScriptDir -ChildPath '..\..\retention.config.json' }
$ConfigPath = Resolve-Path -Path $ConfigPath -ErrorAction Stop
if (-not $AuditLog) { $AuditLog = Join-Path -Path $ScriptDir -ChildPath 'ianus-retention-audit.log' }
$AuditLog = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($AuditLog)

# State
$global:SummaryCompress = 0
$global:SummaryDelete = 0
$global:SummaryArchive = 0
$global:SummaryPurge = 0
$global:SummaryErrors = 0
$global:SummarySkipped = 0

# ──────────────────────────────────────────
# Helper Functions
# ──────────────────────────────────────────

function Write-ColorOutput {
    param(
        [string]$Text,
        [ConsoleColor]$ForegroundColor = 'White',
        [switch]$NoNewline
    )
    if ($NoNewline) {
        Write-Host -ForegroundColor $ForegroundColor -NoNewline $Text
    } else {
        Write-Host -ForegroundColor $ForegroundColor $Text
    }
}

function Write-Heading {
    param([string]$Text)
    Write-ColorOutput "`n── $Text ──" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Text)
    Write-ColorOutput "  [OK] $Text" -ForegroundColor Green
}

function Write-DryRun {
    param([string]$Text)
    Write-ColorOutput "  [DRY-RUN] $Text" -ForegroundColor Yellow
}

function Write-ErrorMsg {
    param([string]$Text)
    $global:SummaryErrors++
    Write-ColorOutput "  [ERROR] $Text" -ForegroundColor Red
}

function Write-AuditLog {
    param(
        [string]$Area,
        [string]$Action,
        [string]$Target,
        [string]$Status = 'success'
    )
    $timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $entry = "[$timestamp] [$Area] [$Action] $Target -> $Status"
    try {
        Add-Content -Path $AuditLog -Value $entry -Encoding UTF8
    } catch {
        Write-ErrorMsg "Failed to write audit log: $_"
    }
}

function Get-AgeInDays {
    param([DateTime]$LastWriteTime)
    return [math]::Floor(((Get-Date) - $LastWriteTime).TotalDays)
}

function Format-FileSize {
    param([long]$Bytes)
    if ($Bytes -ge 1MB) { return '{0:N1} MB' -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return '{0:N1} KB' -f ($Bytes / 1KB) }
    return "$Bytes B"
}

function Get-DirectorySize {
    param([string]$Path)
    try {
        $files = Get-ChildItem -LiteralPath $Path -File -Recurse -ErrorAction Stop
        return ($files | Measure-Object -Property Length -Sum).Sum
    } catch {
        return 0
    }
}

function Get-Config {
    param([string]$ConfigPath)
    if (-not (Test-Path -LiteralPath $ConfigPath)) {
        throw "Config file not found: $ConfigPath"
    }
    try {
        $config = Get-Content -LiteralPath $ConfigPath -Encoding UTF8 | ConvertFrom-Json -AsHashtable
        return $config
    } catch {
        throw "Failed to parse config JSON: $_"
    }
}

function Test-Sqlite3Available {
    try {
        $null = Get-Command 'sqlite3' -ErrorAction Stop
        return $true
    } catch {
        # Try common Git for Windows location
        $gitSqlite = 'C:\Program Files\Git\mingw64\bin\sqlite3.exe'
        if (Test-Path -LiteralPath $gitSqlite) {
            $script:Sqlite3Path = $gitSqlite
            return $true
        }
        # Try scoop/choco locations
        $altPaths = @(
            "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\SQLite.SQLite_Microsoft.Winget.Source_8wekyb3d8bbwe\sqlite3.exe",
            "$env:ProgramData\chocolatey\lib\sqlite\tools\sqlite3.exe"
        )
        foreach ($p in $altPaths) {
            if (Test-Path -LiteralPath $p) {
                $script:Sqlite3Path = $p
                return $true
            }
        }
        return $false
    }
}

function Invoke-Sqlite {
    param(
        [string]$Database,
        [string]$Query
    )
    if (-not (Test-Path -LiteralPath $Database)) {
        throw "Database not found: $Database"
    }
    $exe = if ($script:Sqlite3Path) { $script:Sqlite3Path } else { 'sqlite3' }
    $result = & $exe -json $Database $Query 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "sqlite3 error (exit $LASTEXITCODE): $result"
    }
    return $result
}

# ──────────────────────────────────────────
# Area Processors
# ──────────────────────────────────────────

function Process-IanusBackups {
    param(
        [hashtable]$AreaConfig,
        [string]$AreaKey,
        [bool]$IsExecute,
        [bool]$IsForce
    )

    $backupDir = $AreaConfig.path
    $compressDays = $AreaConfig.compress_after_days
    $deleteDays = $AreaConfig.delete_after_days
    $safeguard = $AreaConfig.safeguard_min_backups
    $useCompression = if ($AreaConfig.ContainsKey('use_compression')) { $AreaConfig.use_compression } else { $true }

    if (-not (Test-Path -LiteralPath $backupDir)) {
        Write-ErrorMsg "Backup directory not found: $backupDir"
        return
    }

    Write-Heading "Area: $AreaKey ($($AreaConfig.label))"

    $backups = Get-ChildItem -LiteralPath $backupDir -Directory | Sort-Object LastWriteTime -Descending
    $totalBackups = $backups.Count

    if ($totalBackups -eq 0) {
        Write-Success "No backup directories found in $backupDir"
        return
    }

    Write-ColorOutput "  Found $totalBackups backup directories" -ForegroundColor Gray

    # Identify the most recent backup (safeguard — never delete the newest one)
    $newestBackup = $backups | Select-Object -First $safeguard
    $newestNames = $newestBackup | ForEach-Object { $_.Name }

    foreach ($backup in $backups) {
        $ageDays = Get-AgeInDays -LastWriteTime $backup.LastWriteTime
        $dirSize = Get-DirectorySize -Path $backup.FullName
        $fileCount = (Get-ChildItem -LiteralPath $backup.FullName -File -Recurse -ErrorAction SilentlyContinue).Count
        $sizeStr = Format-FileSize -Bytes $dirSize
        $isNewest = $backup.Name -in $newestNames

        if ($useCompression -and $ageDays -ge $compressDays -and $ageDays -lt $deleteDays) {
            $tarFile = Join-Path -Path $backupDir -ChildPath "$($backup.Name).tar.gz"
            if ($IsExecute) {
                try {
                    # Compress with tar
                    $compressDir = $backup.FullName
                    $parentDir = Split-Path -Parent $compressDir
                    $dirName = Split-Path -Leaf $compressDir
                    Push-Location -LiteralPath $parentDir
                    try {
                        tar -czf $tarFile $dirName 2>&1 | Out-Null
                    } finally {
                        Pop-Location
                    }
                    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $tarFile)) {
                        # Verify archive then remove directory
                        Remove-Item -LiteralPath $backup.FullName -Recurse -Force
                        Write-Success "Compressed: $($backup.Name)/ ($fileCount files, $sizeStr, ${ageDays}d old) -> $($backup.Name).tar.gz"
                        Write-AuditLog -Area $AreaKey -Action 'COMPRESS' -Target $backup.FullName -Status 'success'
                        $global:SummaryCompress++
                    } else {
                        Write-ErrorMsg "Compression failed for $($backup.Name)"
                        Write-AuditLog -Area $AreaKey -Action 'COMPRESS' -Target $backup.FullName -Status 'failed'
                    }
                } catch {
                    Write-ErrorMsg "Compression error for $($backup.Name): $_"
                    Write-AuditLog -Area $AreaKey -Action 'COMPRESS' -Target $backup.FullName -Status 'error'
                }
            } else {
                Write-DryRun "Compress: $($backup.Name)/ ($fileCount files, $sizeStr, ${ageDays}d old)"
            }
        }
        elseif ($ageDays -ge $deleteDays) {
            if ($isNewest -and $safeguard -gt 0) {
                Write-ColorOutput "  [SKIP] $($backup.Name)/ — newest backup (safeguard)" -ForegroundColor DarkYellow
                $global:SummarySkipped++
                continue
            }
            if ($IsExecute) {
                try {
                    Remove-Item -LiteralPath $backup.FullName -Recurse -Force
                    Write-Success "Deleted: $($backup.Name)/ ($fileCount files, $sizeStr, ${ageDays}d old)"
                    Write-AuditLog -Area $AreaKey -Action 'DELETE' -Target $backup.FullName -Status 'success'
                    $global:SummaryDelete++
                } catch {
                    Write-ErrorMsg "Delete failed for $($backup.Name): $_"
                    Write-AuditLog -Area $AreaKey -Action 'DELETE' -Target $backup.FullName -Status 'error'
                }
            } else {
                Write-DryRun "Delete: $($backup.Name)/ ($fileCount files, $sizeStr, ${ageDays}d old)"
            }
        }
    }

    if ($global:SummaryCompress -eq 0 -and $global:SummaryDelete -eq 0 -and -not $IsExecute) {
        # Check if all are too young
        $maxAge = ($backups | ForEach-Object { Get-AgeInDays -LastWriteTime $_.LastWriteTime } | Measure-Object -Maximum).Maximum
        if ($maxAge -lt $compressDays) {
            Write-ColorOutput "  No backups eligible yet (oldest is ${maxAge}d, need ${compressDays}d for compress, ${deleteDays}d for delete)" -ForegroundColor Gray
        }
    }
}

function Process-TabulariumMetrics {
    param(
        [hashtable]$AreaConfig,
        [string]$AreaKey,
        [bool]$IsExecute,
        [bool]$IsForce
    )

    $dbPath = $AreaConfig.path
    $table = $AreaConfig.table
    $dateField = $AreaConfig.date_field
    $purgeDays = $AreaConfig.purge_after_days
    $archiveBefore = if ($AreaConfig.ContainsKey('archive_before_purge')) { $AreaConfig.archive_before_purge } else { $true }
    $archiveDir = $AreaConfig.archive_dir

    Write-Heading "Area: $AreaKey ($($AreaConfig.label))"

    if (-not (Test-Path -LiteralPath $dbPath)) {
        Write-ErrorMsg "Database not found: $dbPath"
        return
    }

    if (-not (Test-Sqlite3Available)) {
        Write-ErrorMsg "sqlite3 CLI not found. Install it (choco install sqlite) or add Git for Windows to PATH."
        return
    }

    $cutoffDate = (Get-Date).AddDays(-$purgeDays).ToString('yyyy-MM-ddTHH:mm:ss')

    # Count records to purge
    try {
        $countResult = Invoke-Sqlite -Database $dbPath -Query "SELECT COUNT(*) as cnt FROM $table WHERE $dateField < '$cutoffDate'"
        $recordCount = if ($countResult) { ($countResult | ConvertFrom-Json).cnt } else { 0 }
    } catch {
        Write-ErrorMsg "Failed to query ${table}: $_"
        return
    }

    if ($recordCount -eq 0 -or $null -eq $recordCount) {
        Write-ColorOutput "  No records older than ${purgeDays}d found in $table.$dateField" -ForegroundColor Gray
        return
    }

    Write-ColorOutput "  Found $recordCount records in $table older than ${purgeDays}d (cutoff: $cutoffDate)" -ForegroundColor Gray

    # Archive before purge
    if ($archiveBefore) {
        $archiveFile = Join-Path -Path $archiveDir -ChildPath "metrics-archive-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
        if (-not (Test-Path -LiteralPath $archiveDir)) {
            if ($IsExecute) {
                try {
                    New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null
                } catch {
                    Write-ErrorMsg "Failed to create archive directory $archiveDir"
                }
            }
        }

        if ($IsExecute) {
            try {
                # Export to JSON
                $exportQuery = "SELECT json_group_array(json_object('id', id, 'domain', domain, 'metric_name', metric_name, 'value', value, 'tags', tags, 'recorded_at', recorded_at, 'created_at', created_at)) as data FROM $table WHERE $dateField < '$cutoffDate'"
                $jsonResult = Invoke-Sqlite -Database $dbPath -Query $exportQuery
                $jsonArray = $jsonResult | ConvertFrom-Json
                if ($jsonArray.data -and $jsonArray.data.Count -gt 0) {
                    $jsonArray.data | ConvertTo-Json -Depth 4 | Out-File -LiteralPath $archiveFile -Encoding UTF8
                    Write-Success "Archived $recordCount records to $archiveFile"
                    Write-AuditLog -Area $AreaKey -Action 'ARCHIVE' -Target $archiveFile -Status 'success'
                    $global:SummaryArchive++
                }
            } catch {
                Write-ErrorMsg "Failed to archive metrics: $_"
                Write-AuditLog -Area $AreaKey -Action 'ARCHIVE' -Target $archiveFile -Status 'error'
                if (-not $IsForce) {
                    Write-ColorOutput "  Skipping purge due to archive failure. Use -Force to purge anyway." -ForegroundColor Yellow
                    return
                }
            }
        } else {
            Write-DryRun "Archive $recordCount records from $table to $archiveFile"
        }
    }

    # Purge
    if ($IsExecute) {
        try {
            Invoke-Sqlite -Database $dbPath -Query "DELETE FROM $table WHERE $dateField < '$cutoffDate'" | Out-Null
            Write-Success "Purged $recordCount records from $table (older than ${purgeDays}d)"
            Write-AuditLog -Area $AreaKey -Action 'PURGE' -Target "$dbPath.$table" -Status 'success'
            $global:SummaryPurge++
        } catch {
            Write-ErrorMsg "Failed to purge metrics: $_"
            Write-AuditLog -Area $AreaKey -Action 'PURGE' -Target "$dbPath.$table" -Status 'error'
        }
    } else {
        Write-DryRun "Purge $recordCount records from $table WHERE $dateField < '$cutoffDate'"
    }
}

function Process-TabulariumSessions {
    param(
        [hashtable]$AreaConfig,
        [string]$AreaKey,
        [bool]$IsExecute,
        [bool]$IsForce
    )

    $dbPath = $AreaConfig.path
    $table = $AreaConfig.table
    $dateField = $AreaConfig.date_field
    $filter = if ($AreaConfig.ContainsKey('filter')) { $AreaConfig.filter } else { '1=1' }
    $archiveDays = $AreaConfig.archive_after_days
    $deleteAfter = if ($AreaConfig.ContainsKey('delete_after_archive')) { $AreaConfig.delete_after_archive } else { $true }
    $archiveDir = $AreaConfig.archive_dir

    Write-Heading "Area: $AreaKey ($($AreaConfig.label))"

    if (-not (Test-Path -LiteralPath $dbPath)) {
        Write-ErrorMsg "Database not found: $dbPath"
        return
    }

    if (-not (Test-Sqlite3Available)) {
        Write-ErrorMsg "sqlite3 CLI not found. Install it (choco install sqlite) or add Git for Windows to PATH."
        Write-ErrorMsg "You can manually purge with: sqlite3 $dbPath `"DELETE FROM $table WHERE $dateField < datetime('now', '-${archiveDays} days') AND $filter`""
        return
    }

    $cutoffDate = (Get-Date).AddDays(-$archiveDays).ToString('yyyy-MM-ddTHH:mm:ss')
    $whereClause = "$dateField < '$cutoffDate' AND $filter"

    # Count records
    try {
        $countResult = Invoke-Sqlite -Database $dbPath -Query "SELECT COUNT(*) as cnt FROM $table WHERE $whereClause"
        $recordCount = if ($countResult) { ($countResult | ConvertFrom-Json).cnt } else { 0 }
    } catch {
        Write-ErrorMsg "Failed to query ${table}: $_"
        return
    }

    if ($recordCount -eq 0 -or $null -eq $recordCount) {
        Write-ColorOutput "  No session events older than ${archiveDays}d found in $table" -ForegroundColor Gray
        return
    }

    Write-ColorOutput "  Found $recordCount session events older than ${archiveDays}d (cutoff: $cutoffDate)" -ForegroundColor Gray

    # Archive
    $archiveFile = Join-Path -Path $archiveDir -ChildPath "session-events-archive-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
    if (-not (Test-Path -LiteralPath $archiveDir)) {
        if ($IsExecute) {
            try {
                New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null
            } catch {
                Write-ErrorMsg "Failed to create archive directory $archiveDir"
            }
        }
    }

    if ($IsExecute) {
        try {
            # Export to JSON
            $exportQuery = "SELECT json_group_array(json_object('id', id, 'session_id', session_id, 'timestamp', timestamp, 'agent_name', agent_name, 'event_type', event_type, 'summary', summary, 'details', details, 'tags', tags)) as data FROM $table WHERE $whereClause"
            $jsonResult = Invoke-Sqlite -Database $dbPath -Query $exportQuery
            $jsonArray = $jsonResult | ConvertFrom-Json
            if ($jsonArray.data -and $jsonArray.data.Count -gt 0) {
                $jsonArray.data | ConvertTo-Json -Depth 4 | Out-File -LiteralPath $archiveFile -Encoding UTF8
                Write-Success "Archived $recordCount session events to $archiveFile"
                Write-AuditLog -Area $AreaKey -Action 'ARCHIVE' -Target $archiveFile -Status 'success'
                $global:SummaryArchive++
            }
        } catch {
            Write-ErrorMsg "Failed to archive session events: $_"
            Write-AuditLog -Area $AreaKey -Action 'ARCHIVE' -Target $archiveFile -Status 'error'
        }
    } else {
        Write-DryRun "Archive $recordCount session events from $table to $archiveFile"
    }

    # Delete after archive
    if ($deleteAfter) {
        if ($IsExecute) {
            try {
                Invoke-Sqlite -Database $dbPath -Query "DELETE FROM $table WHERE $whereClause" | Out-Null
                Write-Success "Deleted $recordCount archived session events from $table"
                Write-AuditLog -Area $AreaKey -Action 'DELETE' -Target "$dbPath.$table" -Status 'success'
                $global:SummaryDelete++
            } catch {
                Write-ErrorMsg "Failed to delete session events: $_"
                Write-AuditLog -Area $AreaKey -Action 'DELETE' -Target "$dbPath.$table" -Status 'error'
            }
        } else {
            Write-DryRun "Delete $recordCount archived session events from $table WHERE $whereClause"
        }
    }
}

function Process-TabulariumArtifacts {
    param(
        [hashtable]$AreaConfig,
        [string]$AreaKey,
        [bool]$IsExecute,
        [bool]$IsForce
    )

    $searchPath = $AreaConfig.path
    $patterns = $AreaConfig.patterns

    Write-Heading "Area: $AreaKey ($($AreaConfig.label))"

    if (-not (Test-Path -LiteralPath $searchPath)) {
        Write-ErrorMsg "Search path not found: $searchPath"
        return
    }

    $totalFound = 0
    $totalDeleted = 0

    foreach ($pattern in $patterns) {
        $glob = $pattern.glob
        $maxDays = $pattern.max_age_days
        $exclude = if ($pattern.ContainsKey('exclude')) { $pattern.exclude } else { @() }
        $excludeSet = $exclude | ForEach-Object { $_ -as [string] }

        # Build exclude filter
        $files = Get-ChildItem -LiteralPath $searchPath -Filter $glob -File -ErrorAction SilentlyContinue

        foreach ($file in $files) {
            # Check exclude list (by filename)
            if ($file.Name -in $excludeSet) {
                continue
            }

            $ageDays = Get-AgeInDays -LastWriteTime $file.LastWriteTime
            if ($ageDays -lt $maxDays) {
                continue  # File is still within acceptable age
            }

            $totalFound++
            $sizeStr = Format-FileSize -Bytes $file.Length

            if ($IsExecute) {
                try {
                    Remove-Item -LiteralPath $file.FullName -Force
                    Write-Success "Deleted: $($file.Name) ($sizeStr, ${ageDays}d old)"
                    Write-AuditLog -Area $AreaKey -Action 'DELETE' -Target $file.FullName -Status 'success'
                    $totalDeleted++
                    $global:SummaryDelete++
                } catch {
                    Write-ErrorMsg "Delete failed for $($file.Name): $_"
                    Write-AuditLog -Area $AreaKey -Action 'DELETE' -Target $file.FullName -Status 'error'
                }
            } else {
                Write-DryRun "Delete: $($file.Name) ($sizeStr, ${ageDays}d old) — matches glob '$glob', max ${maxDays}d"
            }
        }
    }

    if ($totalFound -eq 0) {
        Write-ColorOutput "  No artifacts match retention criteria in $searchPath" -ForegroundColor Gray
    }
}

# ──────────────────────────────────────────
# Main Execution
# ──────────────────────────────────────────

try {
    # Load configuration
    Write-ColorOutput "═══ $ScriptName v$ScriptVersion — $(if ($Execute) { 'EXECUTE' } else { 'DRY RUN' }) ═══" -ForegroundColor Cyan
    Write-ColorOutput "Config: $ConfigPath" -ForegroundColor Gray

    $config = Get-Config -ConfigPath $ConfigPath
    Write-ColorOutput "Schema: $($config.'$schema')  Version: $($config.version)" -ForegroundColor Gray

    # Verify project root (ianus-backups dir should exist nearby)
    $projectRoot = Split-Path -Parent $ConfigPath
    Write-ColorOutput "Project: $projectRoot" -ForegroundColor Gray

    if ($Execute) {
        Write-ColorOutput "Mode: EXECUTE (changes will be applied)" -ForegroundColor Magenta
        if (-not $Force) {
            Write-ColorOutput "WARNING: This will delete/compress files. Use -Force to skip confirmation." -ForegroundColor Yellow
            $confirm = Read-Host "Proceed with retention execution? [y/N]"
            if ($confirm -notin @('y', 'Y', 'yes', 'YES')) {
                Write-ColorOutput "Aborted by user." -ForegroundColor Yellow
                exit 0
            }
        }
    } else {
        Write-ColorOutput "Mode: DRY-RUN (no changes applied)" -ForegroundColor Yellow
        Write-ColorOutput "Use -Execute to apply retention policy" -ForegroundColor Yellow
    }

    Write-ColorOutput "Audit log: $AuditLog" -ForegroundColor Gray

    # Ensure archive directory exists
    if ($Execute) {
        foreach ($areaKey in @('tabularium_metrics', 'tabularium_sessions')) {
            if ($Area -and $Area -ne $areaKey) { continue }
            $areaConfig = $config.areas[$areaKey]
            if ($areaConfig -and $areaConfig.ContainsKey('archive_dir')) {
                $archiveDir = $areaConfig.archive_dir
                if (-not (Test-Path -LiteralPath $archiveDir)) {
                    New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null
                    Write-Success "Created archive directory: $archiveDir"
                }
            }
        }
    }

    # Process each area
    $areasToProcess = @('ianus_backups', 'tabularium_metrics', 'tabularium_sessions', 'tabularium_artifacts')

    foreach ($areaKey in $areasToProcess) {
        if ($Area -and $Area -ne $areaKey) { continue }

        $areaConfig = $config.areas[$areaKey]
        if (-not $areaConfig) {
            Write-ErrorMsg "Configuration missing for area: $areaKey"
            continue
        }

        # Resolve relative paths from config
        $resolvedConfig = $areaConfig.Clone()
        if ($resolvedConfig.ContainsKey('path') -and -not [System.IO.Path]::IsPathRooted($resolvedConfig.path)) {
            $resolvedConfig.path = Resolve-Path -Path (Join-Path -Path $projectRoot -ChildPath $resolvedConfig.path) -ErrorAction SilentlyContinue
            if (-not $resolvedConfig.path) {
                $resolvedConfig.path = Join-Path -Path $projectRoot -ChildPath $areaConfig.path
            }
        }
        if ($resolvedConfig.ContainsKey('archive_dir') -and -not [System.IO.Path]::IsPathRooted($resolvedConfig.archive_dir)) {
            $resolvedConfig.archive_dir = Join-Path -Path $projectRoot -ChildPath $resolvedConfig.archive_dir
        }

        switch ($areaKey) {
            'ianus_backups' {
                Process-IanusBackups -AreaConfig $resolvedConfig -AreaKey $areaKey -IsExecute $Execute -IsForce $Force
            }
            'tabularium_metrics' {
                Process-TabulariumMetrics -AreaConfig $resolvedConfig -AreaKey $areaKey -IsExecute $Execute -IsForce $Force
            }
            'tabularium_sessions' {
                Process-TabulariumSessions -AreaConfig $resolvedConfig -AreaKey $areaKey -IsExecute $Execute -IsForce $Force
            }
            'tabularium_artifacts' {
                Process-TabulariumArtifacts -AreaConfig $resolvedConfig -AreaKey $areaKey -IsExecute $Execute -IsForce $Force
            }
        }
    }

    # Print summary
    Write-ColorOutput "`n═══ Summary ═══" -ForegroundColor Cyan
    Write-ColorOutput "  Compress:   $global:SummaryCompress" -ForegroundColor $(if ($global:SummaryCompress -gt 0) { 'Green' } else { 'Gray' })
    Write-ColorOutput "  Delete:     $global:SummaryDelete" -ForegroundColor $(if ($global:SummaryDelete -gt 0) { 'Green' } else { 'Gray' })
    Write-ColorOutput "  Archive:    $global:SummaryArchive" -ForegroundColor $(if ($global:SummaryArchive -gt 0) { 'Green' } else { 'Gray' })
    Write-ColorOutput "  Purge (DB): $global:SummaryPurge" -ForegroundColor $(if ($global:SummaryPurge -gt 0) { 'Green' } else { 'Gray' })
    Write-ColorOutput "  Skipped:    $global:SummarySkipped" -ForegroundColor $(if ($global:SummarySkipped -gt 0) { 'DarkYellow' } else { 'Gray' })
    Write-ColorOutput "  Errors:     $global:SummaryErrors" -ForegroundColor $(if ($global:SummaryErrors -gt 0) { 'Red' } else { 'Gray' })

    if (-not $Execute) {
        if ($global:SummaryCompress -eq 0 -and $global:SummaryDelete -eq 0 -and $global:SummaryArchive -eq 0 -and $global:SummaryPurge -eq 0) {
            Write-ColorOutput "  No actions to take. All areas within retention thresholds." -ForegroundColor Green
        }
        Write-ColorOutput "`nUse -Execute to apply changes" -ForegroundColor Yellow
    } else {
        Write-ColorOutput "`nRetention execution complete. See audit log: $AuditLog" -ForegroundColor Green
    }

} catch {
    Write-ErrorMsg "Fatal: $_"
    Write-ColorOutput "Stack: $($_.ScriptStackTrace)" -ForegroundColor Red
    exit 1
}
