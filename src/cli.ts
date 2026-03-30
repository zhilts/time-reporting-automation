import path from "node:path";
import { fileURLToPath } from "node:url";
import { resetWeekCurrent, syncWeekCurrent } from "./week-sync.ts";
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

function printUsage(): void {
  console.log("Usage:");
  console.log("  node ./src/cli.ts sync-week-current [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]");
  console.log("  node ./src/cli.ts reset-week-current [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const configPath = getStringArg(args, "config") ?? "./config/mapping.json";
const privateConfigPath = getStringArg(args, "private-config") ?? "./config/private.mapping.json";

if (command === "sync-week-current") {
  const summary = await syncWeekCurrent({
    rootDir,
    configPath,
    privateConfigPath,
    startDate: getStringArg(args, "start-date"),
    endDate: getStringArg(args, "end-date")
  });

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

if (command === "reset-week-current") {
  const summary = await resetWeekCurrent({
    rootDir,
    configPath,
    privateConfigPath,
    startDate: getStringArg(args, "start-date"),
    endDate: getStringArg(args, "end-date")
  });

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

printUsage();
process.exit(command ? 1 : 0);
