param(
  [string]$BaseUrl = "http://127.0.0.1:3100",
  [string]$CodexAgentId = "6639eec4-c103-429e-b1f8-78e70aa66d38",
  [string]$QwenAgentId = "207bfd5b-cc77-4e0e-8170-476f9f3c494b",
  [string]$OpenRouterAgentId = "720bff48-eab7-4f7c-a2fa-42aa561df1b3"
)

$ErrorActionPreference = "Stop"

$ids = @($CodexAgentId, $QwenAgentId, $OpenRouterAgentId)
foreach ($id in $ids) {
  $agent = Invoke-RestMethod -Uri "$BaseUrl/api/agents/$id" -Method GET
  Write-Host "[$($agent.name)] $($agent.adapterType)"
  Write-Host "promptTemplate=$($agent.adapterConfig.promptTemplate)"
  Write-Host ""
}
