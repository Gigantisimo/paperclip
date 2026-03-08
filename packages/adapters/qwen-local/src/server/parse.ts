import { asNumber, asString, parseObject, parseJson } from "@paperclipai/adapter-utils/server-utils";

function readUsage(event: Record<string, unknown>) {
  const usage = parseObject(event.usage);
  return {
    inputTokens:
      asNumber(usage.input_tokens, 0) ||
      asNumber(usage.prompt_tokens, 0),
    outputTokens:
      asNumber(usage.output_tokens, 0) ||
      asNumber(usage.completion_tokens, 0),
    cachedInputTokens:
      asNumber(usage.cached_input_tokens, 0) ||
      asNumber(usage.cache_read_input_tokens, 0),
  };
}

function extractText(event: Record<string, unknown>): string {
  const direct =
    asString(event.text, "").trim() ||
    asString(event.content, "").trim() ||
    asString(event.message, "").trim() ||
    asString(event.output, "").trim();
  if (direct) return direct;

  const delta = parseObject(event.delta);
  const deltaText =
    asString(delta.text, "").trim() ||
    asString(delta.content, "").trim();
  if (deltaText) return deltaText;

  return "";
}

export function parseQwenOutput(stdout: string, stderr: string) {
  let sessionId: string | null = null;
  let errorMessage: string | null = null;
  const chunks: string[] = [];
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
  };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const event = parseJson(line);
    if (!event) {
      chunks.push(rawLine);
      continue;
    }

    const type = asString(event.type, "");
    if (!sessionId) {
      sessionId =
        asString(event.session_id, "").trim() ||
        asString(event.sessionId, "").trim() ||
        asString(event.thread_id, "").trim() ||
        null;
    }

    if (type === "error" || type === "turn.failed") {
      const err = parseObject(event.error);
      errorMessage =
        asString(event.message, "").trim() ||
        asString(err.message, "").trim() ||
        errorMessage;
    }

    const usageFromEvent = readUsage(event);
    usage.inputTokens = Math.max(usage.inputTokens, usageFromEvent.inputTokens);
    usage.outputTokens = Math.max(usage.outputTokens, usageFromEvent.outputTokens);
    usage.cachedInputTokens = Math.max(usage.cachedInputTokens, usageFromEvent.cachedInputTokens);

    const text = extractText(event);
    if (text) chunks.push(text);
  }

  const stderrFirst = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  const summary = chunks.join("\n").trim();
  return {
    sessionId,
    summary,
    usage,
    errorMessage: errorMessage ?? stderrFirst ?? null,
  };
}
