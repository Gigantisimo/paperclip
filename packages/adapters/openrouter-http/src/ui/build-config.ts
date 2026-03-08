import type { CreateConfigValues } from "@paperclipai/adapter-utils";

const DEFAULT_URL = "https://openrouter.ai/api/v1/chat/completions";

export function buildOpenRouterHttpConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  ac.url = v.url || DEFAULT_URL;
  if (v.model) ac.model = v.model;
  if (v.promptTemplate) ac.promptTemplate = v.promptTemplate;
  if (v.instructionsFilePath) ac.instructionsFilePath = v.instructionsFilePath;
  ac.timeoutSec = 120;
  ac.graceSec = 15;
  return ac;
}
