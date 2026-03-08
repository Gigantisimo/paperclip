import pc from "picocolors";

export function printOpenRouterHttpStreamEvent(raw: string, _debug: boolean): void {
  const text = raw.trim();
  if (!text) return;
  console.log(pc.green(`assistant: ${text}`));
}
