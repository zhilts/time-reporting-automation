import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMapper } from "./mapper.ts";
import { loadConfig } from "./config.ts";
import { fetchAndStoreTogglEntries } from "./toggl-api.ts";
import { prepareUpload, selectUploadBatch, updateUploadState } from "./uploader.ts";
import { launchConfiguredBrowser } from "./browser-launch.ts";
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
  console.log("  node ./src/cli.ts prepare-upload [--input <path>] [--plan-path <path>] [--state-path <path>]");
  console.log("  node ./src/cli.ts select-upload-batch [--plan-path <path>] [--state-path <path>] [--date-from YYYY-MM-DD] [--date-to YYYY-MM-DD] [--limit N]");
  console.log("  node ./src/cli.ts update-upload-state --keys <id1,id2> --status <pending|uploaded|failed|skipped|blocked> [--state-path <path>] [--last-error <text>]");
  console.log("  node ./src/cli.ts launch-browser [--url <url>] [--config <path>] [--private-config <path>]");
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

if (command === "prepare-upload") {
  const summary = prepareUpload({
    rootDir,
    inputPath: getStringArg(args, "input") ?? "./runtime/output/latest/report_items.json",
    configPath,
    privateConfigPath,
    planPath: getStringArg(args, "plan-path") ?? "./runtime/state/upload-plan.json",
    statePath: getStringArg(args, "state-path") ?? "./runtime/state/upload-state.json"
  });

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

if (command === "select-upload-batch") {
  const limitValue = getStringArg(args, "limit");
  const summary = selectUploadBatch({
    rootDir,
    planPath: getStringArg(args, "plan-path") ?? "./runtime/state/upload-plan.json",
    statePath: getStringArg(args, "state-path") ?? "./runtime/state/upload-state.json",
    dateFrom: getStringArg(args, "date-from"),
    dateTo: getStringArg(args, "date-to"),
    limit: limitValue ? Number(limitValue) : undefined
  });

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

if (command === "update-upload-state") {
  const keys = (getStringArg(args, "keys") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const status = getStringArg(args, "status");

  if (!keys.length || !status) {
    printUsage();
    process.exit(1);
  }

  const summary = updateUploadState({
    rootDir,
    statePath: getStringArg(args, "state-path") ?? "./runtime/state/upload-state.json",
    idempotencyKeys: keys,
    status: status as "pending" | "uploaded" | "failed" | "skipped" | "blocked",
    lastError: getStringArg(args, "last-error") ?? null
  });

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

if (command === "launch-browser") {
  const summary = await launchConfiguredBrowser({
    rootDir,
    configPath,
    privateConfigPath,
    urlOverride: getStringArg(args, "url")
  });

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

printUsage();
process.exit(command ? 1 : 0);
