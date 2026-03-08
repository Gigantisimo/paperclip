param(
  [string]$BaseUrl = "http://127.0.0.1:3100",
  [string]$CodexAgentId = "6639eec4-c103-429e-b1f8-78e70aa66d38",
  [string]$QwenAgentId = "207bfd5b-cc77-4e0e-8170-476f9f3c494b",
  [string]$OpenRouterAgentId = "720bff48-eab7-4f7c-a2fa-42aa561df1b3",
  [string]$PromptTemplate = "Respond only in Russian. Write all explanations, plans, and status updates in Russian. Keep technical identifiers, paths, and code unchanged."
)

$ErrorActionPreference = "Stop"

function Get-Agent([string]$id) {
  Invoke-RestMethod -Uri "$BaseUrl/api/agents/$id" -Method GET
}

function To-Hashtable($obj) {
  if ($null -eq $obj) { return @{} }
  if ($obj -is [hashtable]) { return @{} + $obj }
  $hash = @{}
  foreach ($p in $obj.PSObject.Properties) {
    $hash[$p.Name] = $p.Value
  }
  return $hash
}

function Patch-Agent([string]$id, [hashtable]$patch) {
  Invoke-RestMethod -Uri "$BaseUrl/api/agents/$id" -Method PATCH -ContentType "application/json" -Body ($patch | ConvertTo-Json -Depth 30)
}

function Invoke-Heartbeat([string]$id) {
  Invoke-RestMethod -Uri "$BaseUrl/api/agents/$id/heartbeat/invoke" -Method POST -ContentType "application/json" -Body "{}"
}

Write-Host "[fix] Loading agents..."
$codex = Get-Agent $CodexAgentId
$qwen = Get-Agent $QwenAgentId
$open = Get-Agent $OpenRouterAgentId

$ccfg = To-Hashtable $codex.adapterConfig
$ccfg["promptTemplate"] = $PromptTemplate

$qcfg = To-Hashtable $qwen.adapterConfig
$qcfg["extraArgs"] = @("-y", "--output-format", "stream-json")
$qcfg["promptTemplate"] = $PromptTemplate

$ocfg = To-Hashtable $open.adapterConfig
$ocfg["model"] = "openrouter/auto"
$ocfg["timeoutSec"] = 120
$ocfg["promptTemplate"] = $PromptTemplate

Write-Host "[fix] Patching Codex agent config..."
$null = Patch-Agent $CodexAgentId @{ adapterConfig = $ccfg }

Write-Host "[fix] Patching Qwen agent config..."
$null = Patch-Agent $QwenAgentId @{ adapterConfig = $qcfg }

Write-Host "[fix] Patching OpenRouter agent config..."
$null = Patch-Agent $OpenRouterAgentId @{ adapterConfig = $ocfg }

Write-Host "[fix] Triggering heartbeats..."
$null = Invoke-Heartbeat $CodexAgentId
$null = Invoke-Heartbeat $QwenAgentId
$null = Invoke-Heartbeat $OpenRouterAgentId

Write-Host "[fix] Done."
