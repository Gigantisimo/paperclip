import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import { asString, parseObject } from "@paperclipai/adapter-utils/server-utils";

const DEFAULT_URL = "https://openrouter.ai/api/v1/chat/completions";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function deriveModelsUrl(chatCompletionsUrl: string): string {
  try {
    const url = new URL(chatCompletionsUrl);
    if (url.pathname.endsWith("/chat/completions")) {
      url.pathname = url.pathname.replace(/\/chat\/completions$/, "/models");
    } else {
      url.pathname = "/api/v1/models";
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "https://openrouter.ai/api/v1/models";
  }
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const env = parseObject(config.env);

  const urlValue = asString(config.url, DEFAULT_URL).trim() || DEFAULT_URL;
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(urlValue);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      checks.push({
        code: "openrouter_url_invalid_protocol",
        level: "error",
        message: `Unsupported URL protocol: ${parsedUrl.protocol}`,
        hint: "Use an https:// URL.",
      });
    } else {
      checks.push({
        code: "openrouter_url_valid",
        level: "info",
        message: `Configured endpoint: ${parsedUrl.toString()}`,
      });
    }
  } catch {
    checks.push({
      code: "openrouter_url_invalid",
      level: "error",
      message: `Invalid URL: ${urlValue}`,
    });
  }

  const apiKey =
    asString(config.apiKey, "").trim() ||
    asString(env.OPENROUTER_API_KEY, "").trim() ||
    asString(process.env.OPENROUTER_API_KEY, "").trim() ||
    asString(env.OPENAI_API_KEY, "").trim() ||
    asString(process.env.OPENAI_API_KEY, "").trim();

  if (!apiKey) {
    checks.push({
      code: "openrouter_api_key_missing",
      level: "warn",
      message: "OPENROUTER_API_KEY is not set. Runs will fail without API auth.",
      hint: "Set OPENROUTER_API_KEY in adapter env or server env.",
    });
  } else {
    checks.push({
      code: "openrouter_api_key_present",
      level: "info",
      message: "API key is configured.",
    });
  }

  if (parsedUrl && apiKey) {
    const modelsUrl = deriveModelsUrl(parsedUrl.toString());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(modelsUrl, {
        method: "GET",
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        checks.push({
          code: "openrouter_models_probe_failed",
          level: "warn",
          message: `OpenRouter models probe returned HTTP ${response.status}.`,
          hint: "Verify API key validity and network access to OpenRouter.",
        });
      } else {
        checks.push({
          code: "openrouter_models_probe_ok",
          level: "info",
          message: "OpenRouter models probe succeeded.",
        });
      }
    } catch (err) {
      checks.push({
        code: "openrouter_models_probe_error",
        level: "warn",
        message: err instanceof Error ? err.message : "OpenRouter probe failed",
        hint: "This can happen in restricted networks; verify from the Paperclip server host.",
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
