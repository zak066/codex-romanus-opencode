param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('small', 'medium', 'large')]
  [string]$Size
)

$configFile = "opencode.$Size.json"
$targetFile = "opencode.json"

if (-not (Test-Path $configFile)) {
  Write-Error "File $configFile non trovato."
  exit 1
}

Copy-Item -Path $configFile -Destination $targetFile -Force
Write-Host "✅ Team $Size attivato (copia di $configFile → $targetFile)"
Write-Host "🔄 Riavvia opencode per applicare le modifiche."
