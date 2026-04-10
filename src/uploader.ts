import path from "node:path";
import { loadConfig, loadJsonFile } from "./config.ts";
import { ensureDirectory, readInputFile, writeJson } from "./io.ts";
import type {
  AppConfig,
  PrepareUploadOptions,
  PrepareUploadSummary,
  ReportItem,
  SelectUploadBatchOptions,
  SelectUploadBatchSummary,
  UpdateUploadStateOptions,
  UpdateUploadStateSummary,
  UploadPlan,
  UploadPlanItem,
  UploadState,
  UploadStateItem
} from "./types.ts";

function roundMinutes(durationMinutes: number, incrementMinutes: number, policy: "nearest" | "ceil" | "floor"): number {
  if (incrementMinutes <= 0) {
    return durationMinutes;
  }

  const ratio = durationMinutes / incrementMinutes;
  if (policy === "ceil") {
    return Math.ceil(ratio) * incrementMinutes;
  }

  if (policy === "floor") {
    return Math.floor(ratio) * incrementMinutes;
  }

  return Math.round(ratio) * incrementMinutes;
}

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

function toUploadPlanItem(
  item: ReportItem,
  config: AppConfig,
  workDate: string,
  durationMinutesRounded: number,
  timeBucket: "standard" | "overtime"
): UploadPlanItem {
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
    idempotency_key: `${item.idempotency_key}:${workDate}:${timeBucket}:${durationMinutesRounded}`,
    source_report_idempotency_key: item.idempotency_key,
    time_bucket: timeBucket,
    target_project_code: item.target_project_code,
    project_label: projectLabel,
    target_description: item.target_description,
    activity_code: item.activity_code,
    task_id: item.task_id,
    task_label: taskLabel,
    duration_minutes_rounded: durationMinutesRounded,
    effort_hours: formatHours(durationMinutesRounded),
    work_date: workDate,
    start_date: formatDateForTarget(workDate),
    finish_date: formatDateForTarget(workDate),
    entry_type: item.entry_type,
    upload_ready: uploadBlockers.length === 0,
    upload_blockers: uploadBlockers
  };
}

function isWorkingDay(workDate: string, config: AppConfig): boolean {
  const holidays = new Set(config.upload?.holidays ?? []);
  if (holidays.has(workDate)) {
    return false;
  }

  const workingDays = new Set(config.upload?.working_days ?? [1, 2, 3, 4, 5]);
  const [year, month, day] = workDate.split("-").map(Number);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const normalizedDay = utcDay === 0 ? 7 : utcDay;
  return workingDays.has(normalizedDay);
}

function expandReportItemToDailyPlanItems(item: ReportItem, config: AppConfig): UploadPlanItem[] {
  const incrementMinutes = config.rounding.increment_minutes ?? 30;
  const roundingPolicy = config.rounding.policy ?? "nearest";
  const standardLimit = config.upload?.standard_minutes_per_workday ?? 8 * 60;
  const planItems: UploadPlanItem[] = [];

  for (const workDate of Object.keys(item.daily_minutes_raw).sort()) {
    const roundedDayMinutes = roundMinutes(item.daily_minutes_raw[workDate], incrementMinutes, roundingPolicy);
    const standardMinutes = isWorkingDay(workDate, config) ? Math.min(roundedDayMinutes, standardLimit) : 0;
    const overtimeMinutes = roundedDayMinutes - standardMinutes;

    if (standardMinutes > 0) {
      planItems.push(toUploadPlanItem(item, config, workDate, standardMinutes, "standard"));
    }

    if (overtimeMinutes > 0) {
      planItems.push(toUploadPlanItem(item, config, workDate, overtimeMinutes, "overtime"));
    }
  }

  return planItems;
}

function toUploadStateItem(item: UploadPlanItem): UploadStateItem {
  return {
    idempotency_key: item.idempotency_key,
    status: item.upload_ready ? "pending" : "blocked",
    last_error: item.upload_ready ? null : item.upload_blockers.join(" "),
    updated_at: null
  };
}

function readUploadPlan(planPath: string): UploadPlan {
  return loadJsonFile<UploadPlan>(planPath, true) as UploadPlan;
}

function readUploadState(statePath: string): UploadState {
  return loadJsonFile<UploadState>(statePath, true) as UploadState;
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
    .flatMap((item) => expandReportItemToDailyPlanItems(item, config))
    .sort((left, right) => {
      if (left.work_date !== right.work_date) {
        return left.work_date.localeCompare(right.work_date);
      }
      if (left.time_bucket !== right.time_bucket) {
        return left.time_bucket.localeCompare(right.time_bucket);
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

export function selectUploadBatch({
  rootDir,
  planPath = "./runtime/state/upload-plan.json",
  statePath = "./runtime/state/upload-state.json",
  dateFrom,
  dateTo,
  limit
}: SelectUploadBatchOptions): SelectUploadBatchSummary {
  const resolvedPlanPath = path.resolve(rootDir, planPath);
  const resolvedStatePath = path.resolve(rootDir, statePath);
  const plan = readUploadPlan(resolvedPlanPath);
  const state = readUploadState(resolvedStatePath);
  const stateByKey = new Map(state.items.map((item) => [item.idempotency_key, item]));

  const items = plan.items
    .filter((item) => {
      const stateItem = stateByKey.get(item.idempotency_key);
      if (!stateItem || stateItem.status !== "pending") {
        return false;
      }

      if (dateFrom && item.work_date < dateFrom) {
        return false;
      }

      if (dateTo && item.work_date > dateTo) {
        return false;
      }

      return true;
    })
    .slice(0, limit && limit > 0 ? limit : undefined);

  return {
    plan_path: resolvedPlanPath,
    state_path: resolvedStatePath,
    selected_count: items.length,
    items
  };
}

export function updateUploadState({
  rootDir,
  statePath = "./runtime/state/upload-state.json",
  idempotencyKeys,
  status,
  lastError = null
}: UpdateUploadStateOptions): UpdateUploadStateSummary {
  const resolvedStatePath = path.resolve(rootDir, statePath);
  const state = readUploadState(resolvedStatePath);
  const keySet = new Set(idempotencyKeys);
  const now = new Date().toISOString();
  let updatedCount = 0;

  for (const item of state.items) {
    if (!keySet.has(item.idempotency_key)) {
      continue;
    }

    item.status = status;
    item.last_error = lastError;
    item.updated_at = now;
    updatedCount += 1;
  }

  state.updated_at = now;
  writeJson(resolvedStatePath, state);

  return {
    state_path: resolvedStatePath,
    updated_count: updatedCount,
    status,
    idempotency_keys: idempotencyKeys
  };
}
