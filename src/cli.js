import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMapper } from "./mapper.js";

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
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const command = args._[0];

if (command !== "map") {
  printUsage();
  process.exit(command ? 1 : 0);
}

if (!args.input) {
  printUsage();
  process.exit(1);
}

const summary = runMapper({
  rootDir,
  inputPath: args.input,
  outputDir: args["output-dir"] ?? "./runtime/output/latest",
  configPath: args.config ?? "./config/mapping.json",
  privateConfigPath: args["private-config"] ?? "./config/private.mapping.json",
  redact: Boolean(args.redact)
});

console.log(JSON.stringify(summary, null, 2));
