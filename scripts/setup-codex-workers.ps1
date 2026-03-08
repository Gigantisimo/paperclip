param(
  [string]$BaseUrl = "http://127.0.0.1:3100",
  [string]$CompanyName = "Autonomy Lab",
  [string]$WorkspacePath = "",
  [string]$CodexInstructionsFile = "",
  [string]$QwenInstructionsFile = "",
  [string]$OpenRouterInstructionsFile = "",
  [string]$OpenRouterApiKey = "",
  [string]$PromptTemplate = "Respond only in Russian. Write all explanations, plans, and status updates in Russian. Keep technical identifiers, paths, and code unchanged.",
  [switch]$InvokeCodex = $false,
  [switch]$DryRun = $false
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$text) {
  Write-Host "[setup] $text" -ForegroundColor Cyan
}

function Ensure-AbsolutePath([string]$value, [string]$name) {
  if ([string]::IsNullOrWhiteSpace($value)) { return "" }
  if (-not [System.IO.Path]::IsPathRooted($value)) {
    throw "$name must be an absolute path. Got: $value"
  }
  return (Resolve-Path -Path $value).Path
}

function Invoke-Api([string]$Method, [string]$Path, $Body = $null) {
  $uri = "$BaseUrl$Path"
  if ($DryRun) {
    Write-Host "[dry-run] $Method $uri" -ForegroundColor Yellow
    if ($null -ne $Body) {
      $json = $Body | ConvertTo-Json -Depth 20
      Write-Host $json -ForegroundColor DarkYellow
    }
    return $null
  }

  $params = @{
    Uri = $uri
    Method = $Method
    Headers = @{ "Content-Type" = "application/json" }
  }
  if ($null -ne $Body) {
    $params["Body"] = ($Body | ConvertTo-Json -Depth 20)
  }
  return Invoke-RestMethod @params
}

function First-OrNull($items, [scriptblock]$predicate) {
  foreach ($item in $items) {
    if (& $predicate $item) { return $item }
  }
  return $null
}

if ([string]::IsNullOrWhiteSpace($WorkspacePath)) {
  $WorkspacePath = (Get-Location).Path
}

$WorkspacePath = Ensure-AbsolutePath -value $WorkspacePath -name "WorkspacePath"
if (-not (Test-Path -Path $WorkspacePath)) {
  throw "WorkspacePath does not exist: $WorkspacePath"
}

if ($CodexInstructionsFile) {
  $CodexInstructionsFile = Ensure-AbsolutePath -value $CodexInstructionsFile -name "CodexInstructionsFile"
}
if ($QwenInstructionsFile) {
  $QwenInstructionsFile = Ensure-AbsolutePath -value $QwenInstructionsFile -name "QwenInstructionsFile"
}
if ($OpenRouterInstructionsFile) {
  $OpenRouterInstructionsFile = Ensure-AbsolutePath -value $OpenRouterInstructionsFile -name "OpenRouterInstructionsFile"
}

Write-Step "Checking server health at $BaseUrl/api/health"
if (-not $DryRun) {
  $health = Invoke-Api -Method "GET" -Path "/api/health"
  if ($health.status -ne "ok") {
    throw "Server health is not ok: $($health | ConvertTo-Json -Depth 5)"
  }
}

Write-Step "Resolving company: $CompanyName"
$companies = Invoke-Api -Method "GET" -Path "/api/companies"
$company = $null
if ($companies) {
  $company = First-OrNull -items $companies -predicate { param($c) $c.name -eq $CompanyName }
}
if (-not $company) {
  Write-Step "Creating company: $CompanyName"
  $company = Invoke-Api -Method "POST" -Path "/api/companies" -Body @{
    name = $CompanyName
    description = "Codex orchestrator with Qwen/OpenRouter workers"
  }
}
$companyId = if ($company) { $company.id } else { "dryrun-company-id" }

$openRouterSecretId = $null
if (-not [string]::IsNullOrWhiteSpace($OpenRouterApiKey)) {
  Write-Step "Upserting OPENROUTER_API_KEY secret"
  $secrets = Invoke-Api -Method "GET" -Path "/api/companies/$companyId/secrets"
  $existingSecret = $null
  if ($secrets) {
    $existingSecret = First-OrNull -items $secrets -predicate { param($s) $s.name -eq "OPENROUTER_API_KEY" }
  }

  if ($existingSecret) {
    $rotated = Invoke-Api -Method "POST" -Path "/api/secrets/$($existingSecret.id)/rotate" -Body @{
      value = $OpenRouterApiKey
    }
    $openRouterSecretId = if ($rotated) { $rotated.id } else { $existingSecret.id }
  } else {
    $createdSecret = Invoke-Api -Method "POST" -Path "/api/companies/$companyId/secrets" -Body @{
      name = "OPENROUTER_API_KEY"
      value = $OpenRouterApiKey
      description = "Used by openrouter_http worker"
    }
    $openRouterSecretId = if ($createdSecret) { $createdSecret.id } else { "dryrun-secret-id" }
  }
}

Write-Step "Reading existing agents"
$agents = Invoke-Api -Method "GET" -Path "/api/companies/$companyId/agents"

function Ensure-Agent(
  [string]$Name,
  [string]$Role,
  [string]$AdapterType,
  [hashtable]$AdapterConfig,
  [hashtable]$RuntimeConfig,
  [string]$ReportsTo
) {
  $existing = $null
  if ($agents) {
    $existing = First-OrNull -items $agents -predicate { param($a) $a.name -eq $Name }
  }

  $payload = @{
    name = $Name
    role = $Role
    adapterType = $AdapterType
    adapterConfig = $AdapterConfig
    runtimeConfig = $RuntimeConfig
    budgetMonthlyCents = 0
  }
  if (-not [string]::IsNullOrWhiteSpace($ReportsTo)) {
    $payload["reportsTo"] = $ReportsTo
  }

  if ($existing) {
    Write-Step "Updating agent: $Name ($AdapterType)"
    $updated = Invoke-Api -Method "PATCH" -Path "/api/agents/$($existing.id)" -Body $payload
    return if ($updated) { $updated } else { $existing }
  }

  Write-Step "Creating agent: $Name ($AdapterType)"
  return Invoke-Api -Method "POST" -Path "/api/companies/$companyId/agents" -Body $payload
}

$heartbeatConfig = @{
  heartbeat = @{
    enabled = $true
    intervalSec = 300
    wakeOnDemand = $true
    cooldownSec = 10
    maxConcurrentRuns = 1
  }
}

$codexConfig = @{
  cwd = $WorkspacePath
  model = "gpt-5.3-codex"
  dangerouslyBypassApprovalsAndSandbox = $true
  search = $false
  promptTemplate = $PromptTemplate
}
if ($CodexInstructionsFile) { $codexConfig["instructionsFilePath"] = $CodexInstructionsFile }

$codexAgent = Ensure-Agent -Name "Codex Manager" -Role "ceo" -AdapterType "codex_local" -AdapterConfig $codexConfig -RuntimeConfig $heartbeatConfig -ReportsTo ""
$codexAgentId = if ($codexAgent) { $codexAgent.id } else { "dryrun-codex-id" }

$qwenConfig = @{
  cwd = $WorkspacePath
  command = "qwen"
  model = "qwen3-coder-plus"
  promptTemplate = $PromptTemplate
}
if ($QwenInstructionsFile) { $qwenConfig["instructionsFilePath"] = $QwenInstructionsFile }
$qwenAgent = Ensure-Agent -Name "Qwen Worker" -Role "engineer" -AdapterType "qwen_local" -AdapterConfig $qwenConfig -RuntimeConfig $heartbeatConfig -ReportsTo $codexAgentId

$openRouterEnv = @{}
if ($openRouterSecretId) {
  $openRouterEnv["OPENROUTER_API_KEY"] = @{
    type = "secret_ref"
    secretId = $openRouterSecretId
  }
}
$openRouterConfig = @{
  url = "https://openrouter.ai/api/v1/chat/completions"
  model = "qwen/qwen3-coder:free"
  timeoutSec = 120
  promptTemplate = $PromptTemplate
}
if ($openRouterEnv.Count -gt 0) { $openRouterConfig["env"] = $openRouterEnv }
if ($OpenRouterInstructionsFile) { $openRouterConfig["instructionsFilePath"] = $OpenRouterInstructionsFile }

$openRouterAgent = Ensure-Agent -Name "OpenRouter Worker" -Role "researcher" -AdapterType "openrouter_http" -AdapterConfig $openRouterConfig -RuntimeConfig $heartbeatConfig -ReportsTo $codexAgentId

Write-Step "Testing adapter environments"
$null = Invoke-Api -Method "POST" -Path "/api/companies/$companyId/adapters/codex_local/test-environment" -Body @{ adapterConfig = $codexConfig }
$null = Invoke-Api -Method "POST" -Path "/api/companies/$companyId/adapters/qwen_local/test-environment" -Body @{ adapterConfig = $qwenConfig }
$null = Invoke-Api -Method "POST" -Path "/api/companies/$companyId/adapters/openrouter_http/test-environment" -Body @{ adapterConfig = $openRouterConfig }

if ($InvokeCodex) {
  Write-Step "Invoking Codex heartbeat"
  $null = Invoke-Api -Method "POST" -Path "/api/agents/$codexAgentId/heartbeat/invoke" -Body @{}
}

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Company ID: $companyId"
if ($codexAgent) { Write-Host "Codex agent: $($codexAgent.id)" }
if ($qwenAgent) { Write-Host "Qwen agent:  $($qwenAgent.id)" }
if ($openRouterAgent) { Write-Host "OpenRouter agent: $($openRouterAgent.id)" }
if (-not [string]::IsNullOrWhiteSpace($OpenRouterApiKey)) {
  Write-Host "OpenRouter secret: $openRouterSecretId"
}
