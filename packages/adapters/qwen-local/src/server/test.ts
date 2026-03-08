import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asString,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  parseObject,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "qwen");
  const cwd = asString(config.cwd, process.cwd());

  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: false });
    checks.push({
      code: "qwen_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "qwen_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });

  try {
    await ensureCommandResolvable(command, cwd, runtimeEnv);
    checks.push({
      code: "qwen_command_resolvable",
      level: "info",
      message: `Command is executable: ${command}`,
    });
  } catch (err) {
    checks.push({
      code: "qwen_command_unresolvable",
      level: "error",
      message: err instanceof Error ? err.message : "Command is not executable",
      detail: command,
    });
  }

  const canRunProbe =
    checks.every((check) => check.code !== "qwen_cwd_invalid" && check.code !== "qwen_command_unresolvable");

  if (canRunProbe) {
    const probe = await runChildProcess(
      `qwen-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      command,
      ["--help"],
      {
        cwd,
        env,
        timeoutSec: 15,
        graceSec: 3,
        onLog: async () => {},
      },
    );

    if (probe.timedOut) {
      checks.push({
        code: "qwen_help_probe_timeout",
        level: "warn",
        message: "Qwen --help probe timed out.",
        hint: "Run `qwen --help` manually to validate local setup.",
      });
    } else if ((probe.exitCode ?? 1) === 0) {
      checks.push({
        code: "qwen_help_probe_ok",
        level: "info",
        message: "Qwen help probe succeeded.",
      });
    } else {
      checks.push({
        code: "qwen_help_probe_failed",
        level: "warn",
        message: "Qwen command resolved but --help returned a non-zero exit code.",
        hint: "Run `qwen --help` manually and verify your local installation.",
      });
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
