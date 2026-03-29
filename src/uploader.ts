import path from "node:path";
import { ensureDirectory, readInputFile, writeJson } from "./io.ts";
import type {
  PrepareUploadOptions,
  PrepareUploadSummary,
  ReportItem,
  UploadPlan,
  UploadPlanItem,
  UploadState,
  UploadStateItem
} from "./types.ts";

function toUploadPlanItem(item: ReportItem): UploadPlanItem {
  return {
    idempotency_key: item.idempotency_key,
    target_project_code: item.target_project_code,
    target_description: item.target_description,
    task_id: item.task_id,
    duration_minutes_rounded: item.duration_minutes_rounded,
    work_date: item.work_date,
    entry_type: item.entry_type
  };
}

function toUploadStateItem(item: UploadPlanItem): UploadStateItem {
  return {
    idempotency_key: item.idempotency_key,
    status: "pending",
    last_error: null,
    updated_at: null
  };
}

export function prepareUpload({
  rootDir,
  inputPath,
  planPath = "./runtime/state/upload-plan.json",
  statePath = "./runtime/state/upload-state.json"
}: PrepareUploadOptions): PrepareUploadSummary {
  const resolvedInputPath = path.resolve(rootDir, inputPath);
  const resolvedPlanPath = path.resolve(rootDir, planPath);
  const resolvedStatePath = path.resolve(rootDir, statePath);
  const raw = readInputFile(resolvedInputPath) as ReportItem[];

  const uploadItems = raw
    .filter((item) => !item.needs_review)
    .map(toUploadPlanItem)
    .sort((left, right) => {
      if (left.work_date !== right.work_date) {
        return left.work_date.localeCompare(right.work_date);
      }
      return left.idempotency_key.localeCompare(right.idempotency_key);
    });

  const plan: UploadPlan = {
    generated_at: new Date().toISOString(),
    source_report_path: resolvedInputPath,
    item_count: uploadItems.length,
    items: uploadItems
  };

  const state: UploadState = {
    updated_at: new Date().toISOString(),
    items: uploadItems.map(toUploadStateItem)
  };

  ensureDirectory(path.dirname(resolvedPlanPath));
  ensureDirectory(path.dirname(resolvedStatePath));
  writeJson(resolvedPlanPath, plan);
  writeJson(resolvedStatePath, state);

  return {
    source_report_path: resolvedInputPath,
    plan_path: resolvedPlanPath,
    state_path: resolvedStatePath,
    item_count: uploadItems.length
  };
}
