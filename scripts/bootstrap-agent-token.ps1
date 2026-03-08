param(
  [Parameter(Mandatory = $true)]
  [string]$AgentId,

  [Parameter(Mandatory = $true)]
  [string]$CompanyId,

  [string]$ApiBase = "http://127.0.0.1:3100",
  [string]$Profile = "default",
  [string]$ApiKeyEnvVar = "PAPERCLIP_API_KEY",
  [switch]$InstallSkills = $true
)

$ErrorActionPreference = "Stop"

Write-Host "[bootstrap] Creating/updating local CLI key for agent $AgentId..."

$args = @(
  "paperclipai",
  "agent",
  "local-cli",
  $AgentId,
  "--company-id",
  $CompanyId,
  "--json",
  "--key-name",
  "local-cli-auto"
)
if (-not $InstallSkills) {
  $args += "--no-install-skills"
}

$jsonText = & pnpm --silent @args
if ($LASTEXITCODE -ne 0) {
  throw "Failed to create agent key via pnpm paperclipai agent local-cli"
}

$jsonRaw = ($jsonText | Out-String)
$jsonStart = $jsonRaw.IndexOf("{")
if ($jsonStart -lt 0) {
  throw "Could not find JSON payload in local-cli output"
}
$jsonPayload = $jsonRaw.Substring($jsonStart)
$payload = $jsonPayload | ConvertFrom-Json
$token = [string]$payload.key.token
if ([string]::IsNullOrWhiteSpace($token)) {
  throw "No token returned from local-cli command"
}

Write-Host "[bootstrap] Persisting token to user env var $ApiKeyEnvVar..."
[Environment]::SetEnvironmentVariable($ApiKeyEnvVar, $token, "User")
Set-Item -Path "Env:$ApiKeyEnvVar" -Value $token

Write-Host "[bootstrap] Updating Paperclip context profile '$Profile'..."
& pnpm paperclipai context set --profile $Profile --api-base $ApiBase --company-id $CompanyId --api-key-env-var-name $ApiKeyEnvVar --use
if ($LASTEXITCODE -ne 0) {
  throw "Failed to update paperclipai context profile"
}

Write-Host "[bootstrap] Done."
Write-Host "[bootstrap] Next shells will auto-load $ApiKeyEnvVar."
Write-Host "[bootstrap] In current shell it is already set."
