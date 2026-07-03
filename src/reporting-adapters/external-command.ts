import { spawn } from "node:child_process";
import { writeJson } from "../io.ts";
import type { AppConfig } from "../types.ts";
import { markUploadedState } from "./state.ts";
import type { ReportingAdapter, ReportingResetRequest, ReportingResetResult, ReportingSyncRequest, ReportingSyncResult } from "./types.ts";

type ExternalCommandResult = {
  uploaded_keys?: string[];
  reused_existing_keys?: string[];
  deleted_record_ids?: string[];
};

function readExternalCommandConfig(config: AppConfig): { command: string; args: string[]; timeoutMs: number } {
  const externalCommand = config.reporting?.external_command;
  if (!externalCommand?.command) {
    throw new Error("external-command reporting backend requires reporting.external_command.command.");
  }

  return {
    command: externalCommand.command,
    args: externalCommand.args ?? [],
    timeoutMs: externalCommand.timeout_ms ?? 120_000
  };
}

async function runExternalCommand(
  rootDir: string,
  config: AppConfig,
  payload: Record<string, unknown>
): Promise<ExternalCommandResult> {
  const { command, args, timeoutMs } = readExternalCommandConfig(config);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`external-command reporting backend timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`external-command reporting backend exited with code ${code}: ${stderr.trim()}`));
        return;
      }

      try {
        resolve(stdout.trim() ? JSON.parse(stdout) as ExternalCommandResult : {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reject(new Error(`external-command reporting backend returned invalid JSON: ${message}`));
      }
    });

    child.stdin.end(JSON.stringify(payload, null, 2));
  });
}

function validateKeys(keys: unknown, fieldName: string): string[] {
  if (keys === undefined) {
    return [];
  }

  if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string")) {
    throw new Error(`external-command reporting backend returned invalid ${fieldName}; expected string array.`);
  }

  return keys;
}

export const externalCommandReportingAdapter: ReportingAdapter = {
  backend: "external-command",

  async reset({ rootDir, config, weekRange }: ReportingResetRequest): Promise<ReportingResetResult> {
    const result = await runExternalCommand(rootDir, config, {
      operation: "reset",
      start_date: weekRange.startDate,
      end_date: weekRange.endDate,
      protocol_version: 1
    });

    return {
      backend: "external-command",
      deletedRecordIds: validateKeys(result.deleted_record_ids, "deleted_record_ids")
    };
  },

  async sync({ rootDir, config, weekRange, plan, planPath, state, statePath }: ReportingSyncRequest): Promise<ReportingSyncResult> {
    const result = await runExternalCommand(rootDir, config, {
      operation: "sync",
      start_date: weekRange.startDate,
      end_date: weekRange.endDate,
      protocol_version: 1,
      plan_path: planPath,
      items: plan.items.filter((item) => item.upload_ready)
    });
    const uploadedKeys = validateKeys(result.uploaded_keys, "uploaded_keys");
    const reusedExistingKeys = validateKeys(result.reused_existing_keys, "reused_existing_keys");
    writeJson(statePath, markUploadedState(state, [...uploadedKeys, ...reusedExistingKeys]));

    return {
      backend: "external-command",
      uploadedKeys,
      reusedExistingKeys,
      deletedRecordIds: validateKeys(result.deleted_record_ids, "deleted_record_ids")
    };
  }
};
