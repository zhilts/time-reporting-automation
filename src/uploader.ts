import path from "node:path";
import { loadConfig } from "./config.ts";
import { ensureDirectory, readInputFile, writeJson } from "./io.ts";
import type {
  AppConfig,
  PrepareUploadOptions,
  PrepareUploadSummary,
  ReportItem,
  UploadAllocationSummary,
  UploadPlan,
  UploadPlanItem,
  UploadState,
  UploadStateItem
} from "./types.ts";

type TaskMatcher = {
  match_type: "exact" | "prefix" | "includes" | "regex";
  pattern: string;
  task_label: string;
};

function hashValue(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

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

function matchDescription(description: string, matcher: TaskMatcher): boolean {
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

type DailyUploadCandidate = {
  item: ReportItem;
  sourceWorkDate: string;
  roundedDayMinutes: number;
};

type OverflowCandidate = {
  candidate: DailyUploadCandidate;
  overflowMinutes: number;
};

type AllocationRange = {
  startDate?: string;
  endDate?: string;
};

function expandReportItemToDailyCandidates(item: ReportItem, config: AppConfig): DailyUploadCandidate[] {
  const incrementMinutes = config.rounding.increment_minutes ?? 30;
  const roundingPolicy = config.rounding.policy ?? "nearest";

  return Object.keys(item.daily_minutes_raw)
    .sort()
    .map((workDate) => ({
      item,
      sourceWorkDate: workDate,
      roundedDayMinutes: roundMinutes(item.daily_minutes_raw[workDate], incrementMinutes, roundingPolicy)
    }))
    .filter((candidate) => candidate.roundedDayMinutes > 0);
}

function getWeekKey(workDate: string): string {
  const [year, month, day] = workDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const utcDay = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - utcDay + 1);
  return date.toISOString().slice(0, 10);
}

function getFinalUploadMergeKey(item: UploadPlanItem): string {
  return [
    item.work_date,
    item.time_bucket,
    item.target_project_code,
    item.project_label,
    item.task_label ?? "",
    item.task_id ?? "",
    item.target_description,
    item.activity_code ?? "",
    item.entry_type
  ].join("|");
}

function squashAllocatedPlanItems(planItems: UploadPlanItem[]): UploadPlanItem[] {
  const merged = new Map<string, UploadPlanItem>();

  for (const item of planItems) {
    const mergeKey = getFinalUploadMergeKey(item);
    const existing = merged.get(mergeKey);
    if (!existing) {
      merged.set(mergeKey, { ...item });
      continue;
    }

    existing.duration_minutes_rounded += item.duration_minutes_rounded;
    existing.effort_hours = formatHours(existing.duration_minutes_rounded);
  }

  return Array.from(merged.values())
    .sort((left, right) => {
      if (left.work_date !== right.work_date) {
        return left.work_date.localeCompare(right.work_date);
      }
      if (left.time_bucket !== right.time_bucket) {
        return left.time_bucket.localeCompare(right.time_bucket);
      }
      return left.idempotency_key.localeCompare(right.idempotency_key);
    })
    .map((item) => ({
      ...item,
      idempotency_key: hashUploadPlanIdentity(item)
    }));
}

function hashUploadPlanIdentity(item: UploadPlanItem): string {
  return hashValue([
    item.source_report_idempotency_key,
    item.work_date,
    item.time_bucket,
    item.target_project_code,
    item.project_label,
    item.task_label ?? "",
    item.task_id ?? "",
    item.target_description,
    item.activity_code ?? "",
    item.entry_type,
    item.duration_minutes_rounded
  ].join("|"));
}

function isWithinAllocationRange(workDate: string, allocationRange: AllocationRange): boolean {
  if (allocationRange.startDate && workDate < allocationRange.startDate) {
    return false;
  }

  if (allocationRange.endDate && workDate > allocationRange.endDate) {
    return false;
  }

  return true;
}

function allocateDailyPlanItems(rawItems: ReportItem[], config: AppConfig, allocationRange: AllocationRange = {}): UploadPlanItem[] {
  const standardLimit = config.upload?.standard_minutes_per_workday ?? 8 * 60;
  const candidates = rawItems
    .filter((item) => !item.needs_review)
    .flatMap((item) => expandReportItemToDailyCandidates(item, config))
    .sort((left, right) => {
      if (left.sourceWorkDate !== right.sourceWorkDate) {
        return left.sourceWorkDate.localeCompare(right.sourceWorkDate);
      }

      return left.item.idempotency_key.localeCompare(right.item.idempotency_key);
    });

  const weeklyWorkingDays = new Map<string, string[]>();
  for (const candidate of candidates) {
    const weekKey = getWeekKey(candidate.sourceWorkDate);
    const days = weeklyWorkingDays.get(weekKey) ?? [];
    const [year, month, day] = weekKey.split("-").map(Number);

    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(Date.UTC(year, month - 1, day + offset));
      const workDate = date.toISOString().slice(0, 10);
      if (!isWithinAllocationRange(workDate, allocationRange) || !isWorkingDay(workDate, config) || days.includes(workDate)) {
        continue;
      }

      days.push(workDate);
    }

    days.sort();
    weeklyWorkingDays.set(weekKey, days);
  }

  const remainingStandardByDay = new Map<string, number>();
  const planItems: UploadPlanItem[] = [];
  const overflowCandidates: OverflowCandidate[] = [];
  let segmentIndex = 0;

  const addSegment = (
    candidate: DailyUploadCandidate,
    targetWorkDate: string,
    durationMinutes: number,
    timeBucket: "standard" | "overtime"
  ) => {
    segmentIndex += 1;
    const item = toUploadPlanItem(candidate.item, config, targetWorkDate, durationMinutes, timeBucket);
    item.idempotency_key = [
      candidate.item.idempotency_key,
      candidate.sourceWorkDate,
      targetWorkDate,
      timeBucket,
      durationMinutes,
      segmentIndex
    ].join(":");
    planItems.push(item);
  };

  for (const candidate of candidates) {
    const currentRemaining = remainingStandardByDay.has(candidate.sourceWorkDate)
      ? (remainingStandardByDay.get(candidate.sourceWorkDate) ?? 0)
      : standardLimit;
    const canUseSourceStandard = isWorkingDay(candidate.sourceWorkDate, config);
    const sourceStandardMinutes = canUseSourceStandard
      ? Math.min(candidate.roundedDayMinutes, Math.max(0, currentRemaining))
      : 0;
    let overflowMinutes = candidate.roundedDayMinutes - sourceStandardMinutes;

    if (sourceStandardMinutes > 0) {
      addSegment(candidate, candidate.sourceWorkDate, sourceStandardMinutes, "standard");
      remainingStandardByDay.set(candidate.sourceWorkDate, currentRemaining - sourceStandardMinutes);
    }

    if (overflowMinutes > 0) {
      overflowCandidates.push({ candidate, overflowMinutes });
    }
  }

  for (const overflowCandidate of overflowCandidates) {
    const { candidate } = overflowCandidate;
    let overflowMinutes = overflowCandidate.overflowMinutes;
    const weekKey = getWeekKey(candidate.sourceWorkDate);
    const targetWorkingDays = weeklyWorkingDays.get(weekKey) ?? [];

    for (const targetWorkDate of targetWorkingDays) {
      if (overflowMinutes <= 0) {
        break;
      }

      if (targetWorkDate === candidate.sourceWorkDate) {
        continue;
      }

      const targetRemaining = remainingStandardByDay.has(targetWorkDate)
        ? (remainingStandardByDay.get(targetWorkDate) ?? 0)
        : standardLimit;
      const standardMinutes = Math.min(overflowMinutes, Math.max(0, targetRemaining));
      if (standardMinutes <= 0) {
        continue;
      }

      addSegment(candidate, targetWorkDate, standardMinutes, "standard");
      remainingStandardByDay.set(targetWorkDate, targetRemaining - standardMinutes);
      overflowMinutes -= standardMinutes;
    }

    if (overflowMinutes > 0) {
      addSegment(candidate, candidate.sourceWorkDate, overflowMinutes, "overtime");
    }
  }

  return squashAllocatedPlanItems(planItems);
}

function toUploadStateItem(item: UploadPlanItem): UploadStateItem {
  return {
    idempotency_key: item.idempotency_key,
    status: item.upload_ready ? "pending" : "blocked",
    last_error: item.upload_ready ? null : item.upload_blockers.join(" "),
    updated_at: null
  };
}

function buildAllocationSummary(uploadItems: UploadPlanItem[]): UploadAllocationSummary {
  const byDayMap = new Map<string, { standard_minutes: number; overtime_minutes: number }>();
  let totalStandardMinutes = 0;
  let totalOvertimeMinutes = 0;

  for (const item of uploadItems) {
    const day = byDayMap.get(item.work_date) ?? { standard_minutes: 0, overtime_minutes: 0 };
    if (item.time_bucket === "standard") {
      day.standard_minutes += item.duration_minutes_rounded;
      totalStandardMinutes += item.duration_minutes_rounded;
    } else {
      day.overtime_minutes += item.duration_minutes_rounded;
      totalOvertimeMinutes += item.duration_minutes_rounded;
    }

    byDayMap.set(item.work_date, day);
  }

  return {
    total_standard_minutes: totalStandardMinutes,
    total_overtime_minutes: totalOvertimeMinutes,
    by_day: Array.from(byDayMap.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([workDate, totals]) => ({
        work_date: workDate,
        standard_minutes: totals.standard_minutes,
        overtime_minutes: totals.overtime_minutes
      }))
  };
}

export function prepareUpload({
  rootDir,
  inputPath,
  configPath = "./config/mapping.json",
  privateConfigPath = "./config/private.mapping.json",
  planPath = "./runtime/state/upload-plan.json",
  statePath = "./runtime/state/upload-state.json",
  allocationStartDate,
  allocationEndDate
}: PrepareUploadOptions): PrepareUploadSummary {
  const resolvedInputPath = path.resolve(rootDir, inputPath);
  const resolvedPlanPath = path.resolve(rootDir, planPath);
  const resolvedStatePath = path.resolve(rootDir, statePath);
  const config = loadConfig(rootDir, configPath, privateConfigPath);
  const raw = readInputFile(resolvedInputPath) as ReportItem[];

  const uploadItems = allocateDailyPlanItems(raw, config, {
    startDate: allocationStartDate,
    endDate: allocationEndDate
  })
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
    blocked_item_count: blockedItemCount,
    allocation: buildAllocationSummary(uploadItems)
  };
}
