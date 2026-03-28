import fs from "node:fs";
import path from "node:path";
import type { PrimitiveRecord } from "./types.ts";

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsv(content: string): PrimitiveRecord[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: PrimitiveRecord = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

export function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readInputFile(inputPath: string): unknown[] {
  const resolvedPath = path.resolve(inputPath);
  const content = fs.readFileSync(resolvedPath, "utf8");

  if (resolvedPath.endsWith(".json")) {
    return JSON.parse(content) as unknown[];
  }

  if (resolvedPath.endsWith(".csv")) {
    return parseCsv(content);
  }

  throw new Error(`Unsupported input format: ${resolvedPath}`);
}

export function writeJson(filePath: string, value: unknown): void {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}
