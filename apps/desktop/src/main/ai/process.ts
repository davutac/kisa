import { execFile, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const PATH_CAPTURE_START = "__KISA_AI_PATH_START__";
const PATH_CAPTURE_END = "__KISA_AI_PATH_END__";
const WINDOWS_SHELL_META_CHARS = /(?<character>[()\][%!^"`<>&|;, *?])/gu;
const execFileAsync = promisify(execFile);

// oxlint-disable-next-line unicorn/throw-new-error
export class AiCommandError extends Schema.TaggedError<AiCommandError>()(
  "AiCommandError",
  {
    kind: Schema.Literals([
      "failed",
      "not-installed",
      "output-limit",
      "timeout",
    ]),
  }
) {}

export interface AiCommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface AiCommandInput {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly maxOutputBytes?: number;
  readonly stdin?: string;
  readonly timeoutMs: number;
}

interface ResolvedSpawnCommand {
  readonly args: readonly string[];
  readonly command: string;
  readonly shell: boolean;
}

const escapeWindowsShellArg = (argument: string): string => {
  let escaped = argument.replaceAll(
    /(?<slashes>\\*)"/gu,
    '$<slashes>$<slashes>\\"'
  );
  escaped = escaped.replace(/(?<slashes>\\*)$/u, "$<slashes>$<slashes>");
  return `"${escaped}"`.replace(WINDOWS_SHELL_META_CHARS, "^$<character>");
};

const resolveWindowsCommand = (
  command: string,
  environment: NodeJS.ProcessEnv
): string => {
  const extensions = (environment["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.toLowerCase());
  const candidates = path.win32.extname(command)
    ? [command]
    : [command, ...extensions.map((extension) => `${command}${extension}`)];
  const pathEntries = (environment["Path"] ?? environment["PATH"] ?? "").split(
    ";"
  );

  for (const directory of pathEntries) {
    const normalized = directory.trim().replaceAll(/^"|"$/gu, "");
    for (const candidate of candidates) {
      const candidatePath = path.win32.isAbsolute(candidate)
        ? candidate
        : path.win32.join(normalized, candidate);
      try {
        if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
          return candidatePath;
        }
      } catch {
        // Continue through PATH candidates.
      }
    }
  }

  return command;
};

export const resolveAiSpawnCommand = (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv
): ResolvedSpawnCommand => {
  if (process.platform !== "win32") {
    return { args: [...args], command, shell: false };
  }

  const resolvedCommand = resolveWindowsCommand(command, environment);
  const extension = path.win32.extname(resolvedCommand).toLowerCase();
  if (extension !== ".cmd" && extension !== ".bat") {
    return { args: [...args], command: resolvedCommand, shell: false };
  }

  return {
    args: args.map(escapeWindowsShellArg),
    command: escapeWindowsShellArg(resolvedCommand),
    shell: true,
  };
};

export const resolveAiExecutablePath = (
  command: string,
  environment: NodeJS.ProcessEnv
): string | undefined => {
  if (path.isAbsolute(command)) {
    return existsSync(command) && statSync(command).isFile()
      ? command
      : undefined;
  }
  if (process.platform === "win32") {
    const resolved = resolveWindowsCommand(command, environment);
    return resolved === command ? undefined : resolved;
  }
  for (const directory of (environment["PATH"] ?? "").split(":")) {
    const candidate = path.join(directory, command);
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Continue through PATH candidates.
    }
  }
  return undefined;
};

const mergePath = (
  preferred: string | undefined,
  inherited: string | undefined,
  delimiter: string
): string | undefined => {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const value of [preferred, inherited]) {
    for (const entry of value?.split(delimiter) ?? []) {
      const normalized = entry.trim();
      if (normalized.length > 0 && !seen.has(normalized)) {
        seen.add(normalized);
        entries.push(normalized);
      }
    }
  }
  return entries.length > 0 ? entries.join(delimiter) : undefined;
};

const readLoginShellPath = async (): Promise<string | undefined> => {
  if (process.platform === "win32") {
    return undefined;
  }

  let userShell: string | undefined;
  try {
    userShell = os.userInfo().shell ?? undefined;
  } catch {
    userShell = undefined;
  }
  const shell =
    process.env["SHELL"] ??
    userShell ??
    (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");

  try {
    const { stdout } = await execFileAsync(
      shell,
      [
        "-ilc",
        `printf '%s\\n' '${PATH_CAPTURE_START}'; printenv PATH || true; printf '%s\\n' '${PATH_CAPTURE_END}'`,
      ],
      { encoding: "utf-8", timeout: 5000 }
    );
    const output = stdout.toString();
    const start = output.indexOf(PATH_CAPTURE_START);
    const end = output.indexOf(
      PATH_CAPTURE_END,
      start + PATH_CAPTURE_START.length
    );
    if (start === -1 || end === -1) {
      return undefined;
    }
    const value = output.slice(start + PATH_CAPTURE_START.length, end).trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
};

let cachedEnvironment: Promise<NodeJS.ProcessEnv> | undefined;

const loadAiProcessEnvironment = async (): Promise<NodeJS.ProcessEnv> => {
  const environment = { ...process.env };
  if (process.platform === "win32") {
    const knownDirectories = [
      environment["APPDATA"] ? `${environment["APPDATA"]}\\npm` : undefined,
      environment["LOCALAPPDATA"]
        ? `${environment["LOCALAPPDATA"]}\\Programs\\nodejs`
        : undefined,
      environment["LOCALAPPDATA"]
        ? `${environment["LOCALAPPDATA"]}\\pnpm`
        : undefined,
      environment["USERPROFILE"]
        ? `${environment["USERPROFILE"]}\\.local\\bin`
        : undefined,
      environment["USERPROFILE"]
        ? `${environment["USERPROFILE"]}\\.bun\\bin`
        : undefined,
    ].filter((entry): entry is string => entry !== undefined);
    environment["Path"] = mergePath(
      knownDirectories.join(";"),
      environment["Path"] ?? environment["PATH"],
      ";"
    );
  } else {
    environment["PATH"] = mergePath(
      await readLoginShellPath(),
      environment["PATH"],
      ":"
    );
  }

  return environment;
};

export const aiProcessEnvironment: Effect.Effect<NodeJS.ProcessEnv> =
  Effect.promise(() => {
    cachedEnvironment ??= loadAiProcessEnvironment();
    return cachedEnvironment;
  });

export const terminateAiProcess = (
  child: ChildProcessWithoutNullStreams
): void => {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  child.kill("SIGTERM");
  const forceKillTimer = setTimeout(() => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }, 2000);
  forceKillTimer.unref();
};

export const runAiCommand = Effect.fn("runAiCommand")(function* runAiCommand(
  input: AiCommandInput
) {
  const environment = input.env ?? (yield* aiProcessEnvironment);
  return yield* Effect.callback<AiCommandResult, AiCommandError>((resume) => {
    const resolved = resolveAiSpawnCommand(
      input.command,
      input.args,
      environment
    );
    const child = spawn(resolved.command, resolved.args, {
      cwd: input.cwd,
      env: environment,
      shell: resolved.shell,
      stdio: "pipe",
      windowsHide: true,
    });
    const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    let outputBytes = 0;
    let settled = false;
    let stderr = "";
    let stdout = "";

    const timeout = setTimeout(() => {
      terminateAiProcess(child);
      if (!settled) {
        settled = true;
        resume(Effect.fail(new AiCommandError({ kind: "timeout" })));
      }
    }, input.timeoutMs);
    timeout.unref();

    const finish = (effect: Effect.Effect<AiCommandResult, AiCommandError>) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resume(effect);
    };
    const append = (target: "stderr" | "stdout", chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        terminateAiProcess(child);
        finish(Effect.fail(new AiCommandError({ kind: "output-limit" })));
        return;
      }
      if (target === "stdout") {
        stdout += chunk.toString("utf-8");
      } else {
        stderr += chunk.toString("utf-8");
      }
    };
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.once("error", (error: NodeJS.ErrnoException) => {
      finish(
        Effect.fail(
          new AiCommandError({
            kind: error.code === "ENOENT" ? "not-installed" : "failed",
          })
        )
      );
    });
    child.once("close", (exitCode) => {
      finish(
        Effect.succeed({
          exitCode: exitCode ?? 1,
          stderr,
          stdout,
        })
      );
    });

    if (input.stdin === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(input.stdin, "utf-8");
    }

    return Effect.sync(() => {
      clearTimeout(timeout);
      terminateAiProcess(child);
    });
  });
});
