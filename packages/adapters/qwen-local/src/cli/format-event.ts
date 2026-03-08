import pc from "picocolors";

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

export function printQwenStreamEvent(raw: string, _debug: boolean): void {
  const line = raw.trim();
  if (!line) return;

  const parsed = parseJson(line);
  if (!parsed) {
    console.log(line);
    return;
  }

  const type = asString(parsed.type, "");
  if (type === "error") {
    const error = asRecord(parsed.error);
    const message = asString(parsed.message, "").trim() || asString(error?.message, "").trim() || line;
    console.log(pc.red(`error: ${message}`));
    return;
  }

  const text = readText(parsed);
  if (text) {
    if (type.includes("reason") || type.includes("thinking")) {
      console.log(pc.gray(`thinking: ${text}`));
      return;
    }
    console.log(pc.green(`assistant: ${text}`));
    return;
  }

  if (type) {
    console.log(pc.blue(type));
    return;
  }
  console.log(line);
}
