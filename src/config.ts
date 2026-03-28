import fs from "node:fs";
import path from "node:path";
import type { AppConfig, PrimitiveRecord } from "./types.ts";

function isPlainObject(value: unknown): value is PrimitiveRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T>(base: T, overlay: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(overlay)) {
    return overlay as T;
  }

  const merged: PrimitiveRecord = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMerge(merged[key] as PrimitiveRecord, value);
      continue;
    }

    merged[key] = value;
  }

  return merged as T;
}

export function loadJsonFile<T>(filePath: string, required = true): T | null {
  if (!fs.existsSync(filePath)) {
    if (required) {
      throw new Error(`Missing file: ${filePath}`);
    }
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function loadConfig(rootDir: string, configPath: string, privateConfigPath: string): AppConfig {
  const resolvedConfigPath = path.resolve(rootDir, configPath);
  const resolvedPrivateConfigPath = path.resolve(rootDir, privateConfigPath);
  const publicConfig = loadJsonFile<AppConfig>(resolvedConfigPath, true);
  const privateConfig = loadJsonFile<AppConfig>(resolvedPrivateConfigPath, false);
  return deepMerge(publicConfig as AppConfig, privateConfig ?? {});
}

export function normalizeProjectName(projectName: string, aliases: Record<string, string> = {}): string {
  return aliases[projectName] ?? projectName;
}
