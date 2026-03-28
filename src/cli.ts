import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMapper } from "./mapper.ts";
import { loadConfig } from "./config.ts";
import { fetchAndStoreTogglEntries } from "./toggl-api.ts";
import type { CliArgs } from "./types.ts";

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function getStringArg(args: CliArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function hasFlag(args: CliArgs, key: string): boolean {
  return args[key] === true;
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  node ./src/cli.ts map --input <path> [--output-dir <dir>] [--config <path>] [--private-config <path>] [--redact]");
  console.log("  node ./src/cli.ts fetch-toggl [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--output <path>]");
  console.log("  node ./src/cli.ts sync-toggl [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--output-dir <dir>] [--redact]");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const configPath = getStringArg(args, "config") ?? "./config/mapping.json";
const privateConfigPath = getStringArg(args, "private-config") ?? "./config/private.mapping.json";

if (command === "map") {
  const inputPath = getStringArg(args, "input");
  if (!inputPath) {
    printUsage();
    process.exit(1);
  }

  const summary = runMapper({
    rootDir,
    inputPath,
    outputDir: getStringArg(args, "output-dir") ?? "./runtime/output/latest",
    configPath,
    privateConfigPath,
    redact: hasFlag(args, "redact")
  });

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

if (command === "fetch-toggl" || command === "sync-toggl") {
  const config = loadConfig(rootDir, configPath, privateConfigPath);
  const startDate = getStringArg(args, "start-date") ?? config.toggl_api?.default_start_date ?? null;
  const endDate = getStringArg(args, "end-date") ?? config.toggl_api?.default_end_date ?? null;
  const before = getStringArg(args, "before") ?? null;
  const since = getStringArg(args, "since") ?? null;
  const apiToken = process.env.TOGGL_API_TOKEN ?? config.toggl_api?.api_token ?? null;
  const fetchOutputPath = getStringArg(args, "output") ?? "./runtime/input/toggl.time_entries.json";

  const fetchSummary = await fetchAndStoreTogglEntries({
    rootDir,
    apiToken,
    startDate,
    endDate,
    before,
    since,
    outputPath: fetchOutputPath
  });

  if (command === "fetch-toggl") {
    console.log(JSON.stringify(fetchSummary, null, 2));
    process.exit(0);
  }

  const mapSummary = runMapper({
    rootDir,
    inputPath: fetchOutputPath,
    outputDir: getStringArg(args, "output-dir") ?? "./runtime/output/latest",
    configPath,
    privateConfigPath,
    redact: true
  });

  console.log(JSON.stringify({ fetch: fetchSummary, map: mapSummary }, null, 2));
  process.exit(0);
}

printUsage();
process.exit(command ? 1 : 0);
