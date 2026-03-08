import type { UIAdapterModule } from "../types";
import { parseOpenRouterHttpStdoutLine } from "@paperclipai/adapter-openrouter-http/ui";
import { OpenRouterHttpConfigFields } from "./config-fields";
import { buildOpenRouterHttpConfig } from "@paperclipai/adapter-openrouter-http/ui";

export const openRouterHttpUIAdapter: UIAdapterModule = {
  type: "openrouter_http",
  label: "OpenRouter (HTTP)",
  parseStdoutLine: parseOpenRouterHttpStdoutLine,
  ConfigFields: OpenRouterHttpConfigFields,
  buildAdapterConfig: buildOpenRouterHttpConfig,
};
