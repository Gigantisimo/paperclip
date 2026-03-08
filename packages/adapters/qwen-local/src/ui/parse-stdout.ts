import type { TranscriptEntry } from "@paperclipai/adapter-utils";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function readText(rec: Record<string, unknown>): string {
  const delta = asRecord(rec.delta);
  return (
    asString(rec.text, "").trim() ||
    asString(rec.content, "").trim() ||
    asString(rec.message, "").trim() ||
    asString(rec.output, "").trim() ||
    asString(delta?.text, "").trim() ||
    asString(delta?.content, "").trim()
  );
}

export function parseQwenStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const parsed = parseJson(line);
  if (!parsed) {
    return [{ kind: "stdout", ts, text: line }];
  }

  const type = asString(parsed.type, "");
  if (type === "error") {
    const error = asRecord(parsed.error);
    const message = asString(parsed.message, "").trim() || asString(error?.message, "").trim() || line;
    return [{ kind: "stderr", ts, text: message }];
  }

  const text = readText(parsed);
  if (text) {
    if (type.includes("reason") || type.includes("thinking")) {
      return [{ kind: "thinking", ts, text }];
    }
    return [{ kind: "assistant", ts, text }];
  }

  if (type) {
    return [{ kind: "system", ts, text: type }];
  }
  return [{ kind: "stdout", ts, text: line }];
}
