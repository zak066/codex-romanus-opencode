<#
.SYNOPSIS
    Creates or updates the Windows Scheduled Task for Codex Romanus retention.
    Runs weekly on Sundays at 3:00 AM.
    Requires Administrator privileges for task registration.

.NOTES
    Author: Iuppiter / Codex Romanus Team
    Version: 1.0.0

.EXAMPLE
    # Run as Administrator to create/update the scheduled task
    pwsh -File setup-retention-schedule.ps1

.EXAMPLE
    # Manual execution (no admin needed)
    pwsh -File ..\..\ianus-liminalis\scripts\retention.ps1 -Execute -Force
#>

$TaskName = 'CodexRomanus-Retention'
$ProjectRoot = Split-Path -Path $PSScriptRoot -Parent | Split-Path -Parent -Resolve
$BatchPath = Join-Path -Path $PSScriptRoot -ChildPath 'run-retention.bat'

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Warning "This script requires Administrator privileges."
    Write-Warning "Please run: Run As Administrator from the right-click menu."
    Write-Output ""
    Write-Output "To register the task manually as Admin, run:"
    Write-Output "  schtasks /CREATE /TN `"$TaskName`" /TR `"cmd /c `"`"$BatchPath`"`"" /SC WEEKLY /D SUN /ST 03:00 /F /RL HIGHEST"
    Write-Output ""
    Write-Output "Or run retention manually (no admin):"
    Write-Output "  pwsh -File `"$(Join-Path -Path $PSScriptRoot -ChildPath 'retention.ps1')`" -Execute -Force"
    exit 1
}

# Build the command for schtasks
$command = "cmd /c `"$BatchPath`""
Write-Output "Creating scheduled task: $TaskName"
Write-Output "  Schedule: Weekly on Sunday at 03:00"
Write-Output "  Batch:    $BatchPath"
Write-Output ""

$result = schtasks /CREATE /TN $TaskName /TR "$command" /SC WEEKLY /D SUN /ST 03:00 /F /RL HIGHEST 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Output "  [OK] Task created/updated successfully"
    $verify = schtasks /QUERY /TN $TaskName /FO LIST 2>&1
    Write-Output "  Verification:"
    $verify -split "`n" | ForEach-Object { Write-Output "    $_" }
} else {
    Write-Error "schtasks failed: $result"
    exit 1
}
