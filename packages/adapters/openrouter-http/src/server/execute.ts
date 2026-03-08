import fs from "node:fs/promises";
import path from "node:path";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  asNumber,
  asString,
  buildPaperclipEnv,
  ensureAbsoluteDirectory,
  parseObject,
  renderTemplate,
} from "@paperclipai/adapter-utils/server-utils";

const DEFAULT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "qwen/qwen3-coder:free";
const DEFAULT_TIMEOUT_SEC = 120;

function readTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item !== "object" || item === null) return "";
        const rec = item as Record<string, unknown>;
        if (typeof rec.text === "string") return rec.text;
        if (typeof rec.content === "string") return rec.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, onLog, onMeta } = ctx;

  const url = asString(config.url, DEFAULT_URL).trim() || DEFAULT_URL;
  const model = asString(config.model, DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  );
  const timeoutSec = Math.max(1, asNumber(config.timeoutSec, DEFAULT_TIMEOUT_SEC));

  const cwd = asString(config.cwd, process.cwd());
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  const resolvedInstructionsFilePath = instructionsFilePath ? path.resolve(cwd, instructionsFilePath) : "";
  const instructionsDir = resolvedInstructionsFilePath ? `${path.dirname(resolvedInstructionsFilePath)}/` : "";
  let instructionsPrefix = "";
  if (resolvedInstructionsFilePath) {
    try {
      const contents = await fs.readFile(resolvedInstructionsFilePath, "utf8");
      instructionsPrefix =
        `${contents}\n\n` +
        `The above agent instructions were loaded from ${resolvedInstructionsFilePath}. ` +
        `Resolve any relative file references from ${instructionsDir}.\n\n`;
      await onLog("stderr", `[paperclip] Loaded agent instructions file: ${resolvedInstructionsFilePath}\n`);
    } catch (err) {
      await onLog(
        "stderr",
        `[paperclip] Warning: could not read agent instructions file "${resolvedInstructionsFilePath}": ${safeErrorMessage(err)}\n`,
      );
    }
  }

  const renderedPrompt = renderTemplate(promptTemplate, {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  });
  const prompt = `${instructionsPrefix}${renderedPrompt}`;

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = { ...buildPaperclipEnv(agent), PAPERCLIP_RUN_ID: runId };
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const apiKey =
    asString(config.apiKey, "").trim() ||
    env.OPENROUTER_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    env.OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "";
  if (!apiKey) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "Missing OPENROUTER_API_KEY (or OPENAI_API_KEY fallback).",
      provider: "openrouter",
      model,
      billingType: "api",
    };
  }

  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    "http-referer": asString(config.httpReferer, process.env.PAPERCLIP_PUBLIC_URL ?? ""),
    "x-title": asString(config.appTitle, "Paperclip"),
  };
  const requestBody = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: asNumber(config.temperature, 0.2),
  };

  if (onMeta) {
    await onMeta({
      adapterType: "openrouter_http",
      command: "openrouter-chat-completions",
      cwd,
      commandArgs: [url, model],
      env: {
        OPENROUTER_API_KEY: "[REDACTED]",
      },
      prompt,
      context,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSec * 1000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const raw = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      json = null;
    }

    if (!response.ok) {
      const errorMessage =
        (json && typeof json.error === "object" && json.error !== null
          ? asString((json.error as Record<string, unknown>).message, "")
          : "") ||
        raw.slice(0, 400) ||
        `OpenRouter request failed with status ${response.status}`;
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage,
        provider: "openrouter",
        model,
        billingType: "api",
        resultJson: json ?? { raw },
      };
    }

    const choices = json && Array.isArray(json.choices) ? json.choices : [];
    const firstChoice =
      choices.length > 0 && typeof choices[0] === "object" && choices[0] !== null
        ? (choices[0] as Record<string, unknown>)
        : null;
    const message =
      firstChoice &&
      typeof firstChoice.message === "object" &&
      firstChoice.message !== null
        ? (firstChoice.message as Record<string, unknown>)
        : null;
    const content = readTextContent(message?.content ?? "");

    const usage =
      json && typeof json.usage === "object" && json.usage !== null
        ? (json.usage as Record<string, unknown>)
        : {};
    const inputTokens = asNumber(usage.prompt_tokens, 0);
    const outputTokens = asNumber(usage.completion_tokens, 0);
    const cachedInputTokens = asNumber(usage.cached_prompt_tokens, 0);

    if (content) {
      await onLog("stdout", `${content}\n`);
    }

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      errorMessage: null,
      usage: {
        inputTokens,
        outputTokens,
        cachedInputTokens,
      },
      provider: "openrouter",
      model,
      billingType: "api",
      costUsd: asNumber((usage as Record<string, unknown>).cost, 0) || null,
      resultJson: json ?? { raw },
      summary: content || "OpenRouter response received",
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      exitCode: 1,
      signal: null,
      timedOut: aborted,
      errorMessage: aborted ? `Timed out after ${timeoutSec}s` : safeErrorMessage(err),
      provider: "openrouter",
      model,
      billingType: "api",
    };
  } finally {
    clearTimeout(timeout);
  }
}
