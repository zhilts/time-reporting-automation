import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMapper } from "./mapper.js";
import { loadConfig } from "./config.js";
import { fetchAndStoreTogglEntries } from "./toggl-api.js";

function parseArgs(argv) {
  const args = { _: [] };

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

function printUsage() {
  console.log("Usage:");
  console.log("  node ./src/cli.js map --input <path> [--output-dir <dir>] [--config <path>] [--private-config <path>] [--redact]");
  console.log("  node ./src/cli.js fetch-toggl [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--output <path>]");
  console.log("  node ./src/cli.js sync-toggl [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--output-dir <dir>] [--redact]");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const configPath = args.config ?? "./config/mapping.json";
const privateConfigPath = args["private-config"] ?? "./config/private.mapping.json";

if (command === "map") {
  if (!args.input) {
    printUsage();
    process.exit(1);
  }

  const summary = runMapper({
    rootDir,
    inputPath: args.input,
    outputDir: args["output-dir"] ?? "./runtime/output/latest",
    configPath,
    privateConfigPath,
    redact: Boolean(args.redact)
  });

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

if (command === "fetch-toggl" || command === "sync-toggl") {
  const config = loadConfig(rootDir, configPath, privateConfigPath);
  const startDate = args["start-date"] ?? config.toggl_api?.default_start_date ?? null;
  const endDate = args["end-date"] ?? config.toggl_api?.default_end_date ?? null;
  const before = args.before ?? null;
  const since = args.since ?? null;
  const apiToken = process.env.TOGGL_API_TOKEN ?? config.toggl_api?.api_token ?? null;
  const fetchOutputPath = args.output ?? "./runtime/input/toggl.time_entries.json";

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
    outputDir: args["output-dir"] ?? "./runtime/output/latest",
    configPath,
    privateConfigPath,
    redact: true
  });

  console.log(
    JSON.stringify(
      {
        fetch: fetchSummary,
        map: mapSummary
      },
      null,
      2
    )
  );
  process.exit(0);
}

printUsage();
process.exit(command ? 1 : 0);
