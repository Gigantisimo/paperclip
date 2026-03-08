import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  DraftInput,
  help,
} from "../../components/agent-config-primitives";
import { ChoosePathButton } from "../../components/PathInstructionsModal";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";
const instructionsFileHint =
  "Absolute path to a markdown file (e.g. AGENTS.md) that defines this agent's behavior. Injected into the system prompt at runtime.";

export function OpenRouterHttpConfigFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
}: AdapterConfigFieldsProps) {
  return (
    <>
      <Field label="Endpoint URL" hint={help.webhookUrl}>
        <DraftInput
          value={
            isCreate
              ? values!.url
              : eff("adapterConfig", "url", String(config.url ?? "https://openrouter.ai/api/v1/chat/completions"))
          }
          onCommit={(v) =>
            isCreate
              ? set!({ url: v })
              : mark("adapterConfig", "url", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="https://openrouter.ai/api/v1/chat/completions"
        />
      </Field>
      <Field label="Model">
        <DraftInput
          value={
            isCreate
              ? values!.model
              : eff("adapterConfig", "model", String(config.model ?? "qwen/qwen3-coder:free"))
          }
          onCommit={(v) =>
            isCreate
              ? set!({ model: v })
              : mark("adapterConfig", "model", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="qwen/qwen3-coder:free"
        />
      </Field>
      <Field label="Prompt template" hint={help.promptTemplate}>
        <DraftInput
          value={
            isCreate
              ? values!.promptTemplate
              : eff("adapterConfig", "promptTemplate", String(config.promptTemplate ?? ""))
          }
          onCommit={(v) =>
            isCreate
              ? set!({ promptTemplate: v })
              : mark("adapterConfig", "promptTemplate", v || undefined)
          }
          className={inputClass}
          placeholder="Task instructions for this worker..."
        />
      </Field>
      <Field label="Agent instructions file" hint={instructionsFileHint}>
        <div className="flex items-center gap-2">
          <DraftInput
            value={
              isCreate
                ? values!.instructionsFilePath ?? ""
                : eff(
                    "adapterConfig",
                    "instructionsFilePath",
                    String(config.instructionsFilePath ?? ""),
                  )
            }
            onCommit={(v) =>
              isCreate
                ? set!({ instructionsFilePath: v })
                : mark("adapterConfig", "instructionsFilePath", v || undefined)
            }
            immediate
            className={inputClass}
            placeholder="/absolute/path/to/AGENTS.md"
          />
          <ChoosePathButton />
        </div>
      </Field>
    </>
  );
}
