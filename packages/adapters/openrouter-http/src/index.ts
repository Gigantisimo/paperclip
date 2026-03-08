export const type = "openrouter_http";
export const label = "OpenRouter (HTTP)";

export const models = [
  { id: "qwen/qwen3-coder:free", label: "qwen/qwen3-coder:free" },
  { id: "deepseek/deepseek-r1:free", label: "deepseek/deepseek-r1:free" },
  { id: "openrouter/auto", label: "openrouter/auto" },
];

export const agentConfigurationDoc = `# openrouter_http agent configuration

Adapter: openrouter_http

Use when:
- You want a remote low-cost/free worker model through OpenRouter.
- You do not need a local CLI runtime.

Core fields:
- model (string, optional): OpenRouter model id (default qwen/qwen3-coder:free).
- url (string, optional): OpenRouter chat completions endpoint.
- promptTemplate (string, optional): run prompt template.
- instructionsFilePath (string, optional): optional markdown instructions file prepended to prompt.
- env (object, optional): environment variables; OPENROUTER_API_KEY is recommended.

Operational fields:
- timeoutSec (number, optional): request timeout in seconds (default 120).
- graceSec (number, optional): accepted for compatibility; unused by HTTP execution.

Auth:
- Uses OPENROUTER_API_KEY from adapter env or server env.
- Fallback: OPENAI_API_KEY can be used if OPENROUTER_API_KEY is not present.
`;
