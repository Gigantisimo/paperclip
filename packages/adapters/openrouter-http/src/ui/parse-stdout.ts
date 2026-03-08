import type { TranscriptEntry } from "@paperclipai/adapter-utils";

export function parseOpenRouterHttpStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const text = line.trim();
  if (!text) return [];
  return [{ kind: "assistant", ts, text }];
}
