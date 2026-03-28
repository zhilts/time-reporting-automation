import fs from "node:fs";
import path from "node:path";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, overlay) {
  if (!isPlainObject(base) || !isPlainObject(overlay)) {
    return overlay;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

export function loadJsonFile(filePath, required = true) {
  if (!fs.existsSync(filePath)) {
    if (required) {
      throw new Error(`Missing file: ${filePath}`);
    }
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function loadConfig(rootDir, configPath, privateConfigPath) {
  const resolvedConfigPath = path.resolve(rootDir, configPath);
  const resolvedPrivateConfigPath = path.resolve(rootDir, privateConfigPath);
  const publicConfig = loadJsonFile(resolvedConfigPath, true);
  const privateConfig = loadJsonFile(resolvedPrivateConfigPath, false);
  return deepMerge(publicConfig, privateConfig ?? {});
}

export function normalizeProjectName(projectName, aliases = {}) {
  return aliases[projectName] ?? projectName;
}
