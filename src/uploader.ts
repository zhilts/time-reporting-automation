import path from "node:path";
import { loadConfig } from "./config.ts";
import { ensureDirectory, readInputFile, writeJson } from "./io.ts";
import type {
  AppConfig,
  PrepareUploadOptions,
  PrepareUploadSummary,
  ReportItem,
  UploadPlan,
  UploadPlanItem,
  UploadState,
  UploadStateItem
} from "./types.ts";

function formatHours(durationMinutes: number): string {
  const hours = durationMinutes / 60;
  return hours.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function formatDateForTarget(workDate: string): string {
  const [year, month, day] = workDate.split("-");
  return `${day}.${month}.${year}`;
}

function matchDescription(
  description: string,
  matcher: NonNullable<AppConfig["upload"]>["task_matchers_by_project"][string][number]
): boolean {
  if (matcher.match_type === "exact") {
    return description === matcher.pattern;
  }

  if (matcher.match_type === "prefix") {
    return description.startsWith(matcher.pattern);
  }

  if (matcher.match_type === "includes") {
    return description.includes(matcher.pattern);
  }

  return new RegExp(matcher.pattern).test(description);
}

function resolveTaskLabel(item: ReportItem, config: AppConfig): string | null {
  const uploadConfig = config.upload ?? {};
  const projectCode = item.target_project_code;

  const activityLabel = item.activity_code ?? null;
  if (activityLabel) {
    const mappedActivityLabel = uploadConfig.task_by_activity_code?.[projectCode]?.[activityLabel];
    if (mappedActivityLabel) {
      return mappedActivityLabel;
    }

    return activityLabel;
  }

  const matchers = uploadConfig.task_matchers_by_project?.[projectCode] ?? [];
  for (const matcher of matchers) {
    if (matchDescription(item.target_description, matcher)) {
      return matcher.task_label;
    }
  }

  return uploadConfig.default_task_by_project?.[projectCode] ?? null;
}

function toUploadPlanItem(item: ReportItem, config: AppConfig): UploadPlanItem {
  const projectLabel = config.upload?.project_option_labels?.[item.target_project_code] ?? item.target_project_code;
  const taskLabel = resolveTaskLabel(item, config);
  const uploadBlockers: string[] = [];

  if (!projectLabel) {
    uploadBlockers.push("Target project label is missing.");
  }

  if (!taskLabel) {
    uploadBlockers.push("Target task label could not be resolved.");
  }

  return {
    idempotency_key: item.idempotency_key,
    target_project_code: item.target_project_code,
    project_label: projectLabel,
    target_description: item.target_description,
    activity_code: item.activity_code,
    task_id: item.task_id,
    task_label: taskLabel,
    duration_minutes_rounded: item.duration_minutes_rounded,
    effort_hours: formatHours(item.duration_minutes_rounded),
    work_date: item.work_date,
    start_date: formatDateForTarget(item.work_date),
    finish_date: formatDateForTarget(item.work_date),
    entry_type: item.entry_type,
    upload_ready: uploadBlockers.length === 0,
    upload_blockers: uploadBlockers
  };
}

function toUploadStateItem(item: UploadPlanItem): UploadStateItem {
  return {
    idempotency_key: item.idempotency_key,
    status: item.upload_ready ? "pending" : "blocked",
    last_error: item.upload_ready ? null : item.upload_blockers.join(" "),
    updated_at: null
  };
}

export function prepareUpload({
  rootDir,
  inputPath,
  configPath = "./config/mapping.json",
  privateConfigPath = "./config/private.mapping.json",
  planPath = "./runtime/state/upload-plan.json",
  statePath = "./runtime/state/upload-state.json"
}: PrepareUploadOptions): PrepareUploadSummary {
  const resolvedInputPath = path.resolve(rootDir, inputPath);
  const resolvedPlanPath = path.resolve(rootDir, planPath);
  const resolvedStatePath = path.resolve(rootDir, statePath);
  const config = loadConfig(rootDir, configPath, privateConfigPath);
  const raw = readInputFile(resolvedInputPath) as ReportItem[];

  const uploadItems = raw
    .filter((item) => !item.needs_review)
    .map((item) => toUploadPlanItem(item, config))
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

  const readyItemCount = uploadItems.filter((item) => item.upload_ready).length;
  const blockedItemCount = uploadItems.length - readyItemCount;

  return {
    source_report_path: resolvedInputPath,
    plan_path: resolvedPlanPath,
    state_path: resolvedStatePath,
    item_count: uploadItems.length,
    ready_item_count: readyItemCount,
    blocked_item_count: blockedItemCount
  };
}
