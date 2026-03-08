export const type = "qwen_local";
export const label = "Qwen (local)";

export const models = [
  { id: "qwen3-coder-plus", label: "qwen3-coder-plus" },
  { id: "qwen3-coder", label: "qwen3-coder" },
  { id: "qwen2.5-coder", label: "qwen2.5-coder" },
];

export const agentConfigurationDoc = `# qwen_local agent configuration

Adapter: qwen_local

Use when:
- You want a low-cost local CLI worker agent.
- You need a local model worker delegated by a higher-level manager (for example codex_local).

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process.
- instructionsFilePath (string, optional): absolute path to markdown instructions file prepended to prompt.
- promptTemplate (string, optional): run prompt template.
- model (string, optional): model id passed as --model <id>.
- command (string, optional): defaults to "qwen".
- extraArgs (string[], optional): additional CLI args appended before stdin prompt.
- env (object, optional): KEY=VALUE environment variables.

Operational fields:
- timeoutSec (number, optional): run timeout in seconds (0 = disabled).
- graceSec (number, optional): SIGTERM grace period in seconds.

Notes:
- qwen_local is a generic CLI wrapper. Different Qwen CLIs can require different args.
- If your installed qwen command needs special flags, configure them through extraArgs.
`;
