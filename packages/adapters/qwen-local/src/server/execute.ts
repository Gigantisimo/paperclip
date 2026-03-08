import fs from "node:fs/promises";
import path from "node:path";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  asNumber,
  asString,
  asStringArray,
  buildPaperclipEnv,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  parseObject,
  redactEnvForLogs,
  renderTemplate,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import { parseQwenOutput } from "./parse.js";

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function parseExtraArgs(config: Record<string, unknown>): string[] {
  const extraArgs = asStringArray(config.extraArgs);
  if (extraArgs.length > 0) return extraArgs;
  return asStringArray(config.args);
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, authToken } = ctx;

  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  );
  const command = asString(config.command, "qwen");
  const model = asString(config.model, "").trim();
  const cwd = asString(config.cwd, process.cwd());
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const envConfig = parseObject(config.env);
  const hasExplicitApiKey =
    typeof envConfig.PAPERCLIP_API_KEY === "string" &&
    envConfig.PAPERCLIP_API_KEY.trim().length > 0;
  const env: Record<string, string> = { ...buildPaperclipEnv(agent), PAPERCLIP_RUN_ID: runId };
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  if (!hasExplicitApiKey && authToken) {
    env.PAPERCLIP_API_KEY = authToken;
  }

  const runtimeEnv = Object.fromEntries(
    Object.entries(ensurePathInEnv({ ...process.env, ...env })).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  await ensureCommandResolvable(command, cwd, runtimeEnv);

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
      const reason = err instanceof Error ? err.message : String(err);
      await onLog(
        "stderr",
        `[paperclip] Warning: could not read agent instructions file "${resolvedInstructionsFilePath}": ${reason}\n`,
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

  const timeoutSec = asNumber(config.timeoutSec, 0);
  const graceSec = asNumber(config.graceSec, 15);
  const extraArgs = parseExtraArgs(config);

  const args = [...extraArgs];
  if (model) args.push("--model", model);
  args.push("-");

  if (onMeta) {
    await onMeta({
      adapterType: "qwen_local",
      command,
      cwd,
      commandArgs: args.map((value) => (value === "-" ? `<prompt ${prompt.length} chars>` : value)),
      env: redactEnvForLogs(env),
      prompt,
      context,
    });
  }

  const proc = await runChildProcess(runId, command, args, {
    cwd,
    env: runtimeEnv,
    stdin: prompt,
    timeoutSec,
    graceSec,
    onLog,
  });

  if (proc.timedOut) {
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: true,
      errorMessage: `Timed out after ${timeoutSec}s`,
    };
  }

  const parsed = parseQwenOutput(proc.stdout, proc.stderr);
  const exitCode = proc.exitCode ?? 0;
  const parsedError = parsed.errorMessage?.trim() ?? "";
  const stderrLine = firstNonEmptyLine(proc.stderr);
  const errorMessage =
    exitCode === 0 && !parsedError
      ? null
      : parsedError || stderrLine || `Qwen exited with code ${exitCode}`;

  const runtimeSessionParams = parseObject(runtime.sessionParams);
  const resolvedSessionId =
    parsed.sessionId ||
    asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "") ||
    null;

  return {
    exitCode: proc.exitCode,
    signal: proc.signal,
    timedOut: false,
    errorMessage,
    usage: parsed.usage,
    sessionId: resolvedSessionId,
    sessionParams: resolvedSessionId ? { sessionId: resolvedSessionId, cwd } : null,
    sessionDisplayId: resolvedSessionId,
    provider: "qwen",
    model: model || null,
    billingType: "unknown",
    costUsd: null,
    resultJson: {
      stdout: proc.stdout,
      stderr: proc.stderr,
    },
    summary: parsed.summary,
  };
}
