@echo off
REM Codex Romanus — Retention Policy Executor (ADR-032)
REM Runs weekly via Windows Scheduled Task
REM Wrapper to avoid schtasks quoting issues

cd /d "%~dp0\..\.."
powershell -ExecutionPolicy Bypass -File "ianus-liminalis\scripts\retention.ps1" -Execute -Force
