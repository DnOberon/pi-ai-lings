import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserConfig } from "./types.ts";

const USER_CONFIG_PATH = [".pi", "agent", "extensions", "ai-lings", "config.json"];

function userConfigFilename(): string {
  return path.join(os.homedir(), ...USER_CONFIG_PATH);
}

export function readUserConfig(filename = userConfigFilename()): UserConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { directories: [] };
    }
    throw new Error(`Could not read ${filename}: ${(error as Error).message}`);
  }
  if (!raw || typeof raw !== "object") {
    throw new Error(`Could not read ${filename}: config must be an object`);
  }
  const config = raw as { directories?: unknown; model?: unknown };
  if (
    config.directories !== undefined &&
    (!Array.isArray(config.directories) ||
      config.directories.some(
        (directory) => typeof directory !== "string" || !directory.trim(),
      ))
  ) {
    throw new Error(
      `Could not read ${filename}: directories must be a list of paths`,
    );
  }
  if (
    config.model !== undefined &&
    (typeof config.model !== "string" || !config.model.trim())
  ) {
    throw new Error(
      `Could not read ${filename}: model must be a non-empty string`,
    );
  }
  return {
    directories:
      (config.directories as string[] | undefined)?.map((directory) =>
        path.resolve(path.dirname(filename), directory),
      ) ?? [],
    model: typeof config.model === "string" ? config.model.trim() : undefined,
  };
}

export function writeUserConfig(
  config: UserConfig,
  filename = userConfigFilename(),
): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function isDirectoryEnabled(
  cwd: string,
  filename = userConfigFilename(),
): boolean {
  const directory = path.resolve(cwd);
  return readUserConfig(filename).directories.some((enabledDirectory) => {
    const relative = path.relative(enabledDirectory, directory);
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  });
}
