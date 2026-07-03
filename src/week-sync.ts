import fs from "node:fs";
import path from "node:path";
import { loadConfig, loadJsonFile } from "./config.ts";
import { fetchAndStoreTogglEntries } from "./toggl-api.ts";
import { runMapper } from "./mapper.ts";
import { prepareUpload } from "./uploader.ts";
import { writeJson } from "./io.ts";
import { createReportingAdapter } from "./reporting-adapters/index.ts";
import type { MapperSummary, UploadAllocationSummary, UploadPlan, UploadState, WeekRange } from "./types.ts";

const WEEK_FETCH_PATH = "./runtime/input/toggl.time_entries.json";
const WEEK_OUTPUT_DIR = "./runtime/output/week-current";
const WEEK_REPORT_PATH = "./runtime/output/week-current/report_items.json";
const WEEK_PLAN_PATH = "./runtime/state/upload-plan.week-current.json";
const WEEK_STATE_PATH = "./runtime/state/upload-state.week-current.json";
const WEEK_SYNC_SUMMARY_PATH = "./runtime/output/week-current/sync-summary.json";
const LEGACY_OUTPUT_DIR = "./runtime/output/latest";
const LEGACY_PLAN_PATH = "./runtime/state/upload-plan.json";
const LEGACY_STATE_PATH = "./runtime/state/upload-state.json";

export type SyncWeekCurrentSummary = {
  start_date: string;
  end_date: string;
  reporting_backend: string;
  deleted_record_ids: string[];
  uploaded_keys: string[];
  reused_existing_keys: string[];
  output_path: string;
  fetch_entries: number;
  mapped_items: number;
  allocation: UploadAllocationSummary;
};

export type ResetWeekCurrentSummary = {
  start_date: string;
  end_date: string;
  reporting_backend: string;
  deleted_record_ids: string[];
  removed_files: string[];
  removed_directories: string[];
};

function getCurrentWeekRange(): WeekRange {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const localMidnight = new Date(year, month, day);
  const jsDay = localMidnight.getDay();
  const offsetToMonday = jsDay === 0 ? -6 : 1 - jsDay;

  const monday = new Date(localMidnight);
  monday.setDate(localMidnight.getDate() + offsetToMonday);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const toIso = (value: Date) => {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  return {
    startDate: toIso(monday),
    endDate: toIso(sunday)
  };
}

function resolveWeekRange(startDate?: string, endDate?: string): WeekRange {
  const currentWeek = getCurrentWeekRange();
  return {
    startDate: startDate ?? currentWeek.startDate,
    endDate: endDate ?? currentWeek.endDate
  };
}

function pruneEmptyDirectory(directoryPath: string, stopAtPath: string, removedDirectories: string[]): void {
  let currentPath = directoryPath;
  const absoluteStopAtPath = path.resolve(stopAtPath);

  while (currentPath.startsWith(absoluteStopAtPath) && currentPath !== absoluteStopAtPath) {
    if (!fs.existsSync(currentPath) || !fs.statSync(currentPath).isDirectory()) {
      currentPath = path.dirname(currentPath);
      continue;
    }

    if (fs.readdirSync(currentPath).length > 0) {
      return;
    }

    fs.rmdirSync(currentPath);
    removedDirectories.push(currentPath);
    currentPath = path.dirname(currentPath);
  }
}

function removeFileIfExists(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  fs.unlinkSync(filePath);
}

function cleanupRuntimeArtifacts(rootDir: string): { removedFiles: string[]; removedDirectories: string[] } {
  const removedFiles: string[] = [];
  const removedDirectories: string[] = [];
  const absoluteFetchPath = path.resolve(rootDir, WEEK_FETCH_PATH);
  const absoluteStatePath = path.resolve(rootDir, WEEK_STATE_PATH);
  const absolutePlanPath = path.resolve(rootDir, WEEK_PLAN_PATH);
  const absoluteSyncSummaryPath = path.resolve(rootDir, WEEK_SYNC_SUMMARY_PATH);
  const absoluteOutputDir = path.resolve(rootDir, WEEK_OUTPUT_DIR);
  const absoluteLegacyPlanPath = path.resolve(rootDir, LEGACY_PLAN_PATH);
  const absoluteLegacyStatePath = path.resolve(rootDir, LEGACY_STATE_PATH);
  const absoluteLegacyOutputDir = path.resolve(rootDir, LEGACY_OUTPUT_DIR);
  const runtimeRoot = path.resolve(rootDir, "./runtime");

  for (const filePath of [
    absoluteFetchPath,
    absoluteStatePath,
    absolutePlanPath,
    absoluteSyncSummaryPath,
    absoluteLegacyPlanPath,
    absoluteLegacyStatePath
  ]) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    fs.unlinkSync(filePath);
    removedFiles.push(filePath);
    pruneEmptyDirectory(path.dirname(filePath), runtimeRoot, removedDirectories);
  }

  for (const directoryPath of [absoluteOutputDir, absoluteLegacyOutputDir]) {
    if (!fs.existsSync(directoryPath)) {
      continue;
    }

    fs.rmSync(directoryPath, { recursive: true, force: true });
    removedDirectories.push(directoryPath);
    pruneEmptyDirectory(path.dirname(directoryPath), runtimeRoot, removedDirectories);
  }

  return {
    removedFiles,
    removedDirectories: [...new Set(removedDirectories)]
  };
}

function cleanupTransientSyncFiles(rootDir: string): void {
  removeFileIfExists(path.resolve(rootDir, WEEK_FETCH_PATH));
  removeFileIfExists(path.resolve(rootDir, WEEK_PLAN_PATH));
  removeFileIfExists(path.resolve(rootDir, WEEK_REPORT_PATH));
  removeFileIfExists(path.resolve(rootDir, path.join(WEEK_OUTPUT_DIR, "report_items.redacted.json")));
  removeFileIfExists(path.resolve(rootDir, path.join(WEEK_OUTPUT_DIR, "exceptions.json")));
  removeFileIfExists(path.resolve(rootDir, path.join(WEEK_OUTPUT_DIR, "run-summary.json")));

  const removedDirectories: string[] = [];
  const runtimeRoot = path.resolve(rootDir, "./runtime");
  pruneEmptyDirectory(path.resolve(rootDir, "./runtime/input"), runtimeRoot, removedDirectories);
}

export async function resetWeekCurrent({
  rootDir,
  configPath = "./config/mapping.json",
  privateConfigPath = "./config/private.mapping.json",
  startDate,
  endDate
}: {
  rootDir: string;
  configPath?: string;
  privateConfigPath?: string;
  startDate?: string;
  endDate?: string;
}): Promise<ResetWeekCurrentSummary> {
  const weekRange = resolveWeekRange(startDate, endDate);
  const config = loadConfig(rootDir, configPath, privateConfigPath);
  const adapter = createReportingAdapter(config);
  const resetResult = await adapter.reset({
    rootDir,
    config,
    weekRange
  });
  const cleanupResult = cleanupRuntimeArtifacts(rootDir);

  return {
    start_date: weekRange.startDate,
    end_date: weekRange.endDate,
    reporting_backend: resetResult.backend,
    deleted_record_ids: resetResult.deletedRecordIds,
    removed_files: cleanupResult.removedFiles,
    removed_directories: cleanupResult.removedDirectories
  };
}

export async function syncWeekCurrent({
  rootDir,
  configPath = "./config/mapping.json",
  privateConfigPath = "./config/private.mapping.json",
  startDate,
  endDate
}: {
  rootDir: string;
  configPath?: string;
  privateConfigPath?: string;
  startDate?: string;
  endDate?: string;
}): Promise<SyncWeekCurrentSummary> {
  const weekRange = resolveWeekRange(startDate, endDate);
  const config = loadConfig(rootDir, configPath, privateConfigPath);
  const apiToken = process.env.TOGGL_API_TOKEN ?? config.toggl_api?.api_token ?? null;
  const fetchSummary = await fetchAndStoreTogglEntries({
    rootDir,
    apiToken,
    startDate: weekRange.startDate,
    endDate: weekRange.endDate,
    outputPath: WEEK_FETCH_PATH
  });

  const mapSummary: MapperSummary = runMapper({
    rootDir,
    inputPath: WEEK_FETCH_PATH,
    outputDir: WEEK_OUTPUT_DIR,
    configPath,
    privateConfigPath,
    redact: true
  });

  const prepareSummary = prepareUpload({
    rootDir,
    inputPath: WEEK_REPORT_PATH,
    configPath,
    privateConfigPath,
    planPath: WEEK_PLAN_PATH,
    statePath: WEEK_STATE_PATH
  });

  const plan = loadJsonFile<UploadPlan>(path.resolve(rootDir, WEEK_PLAN_PATH), true) as UploadPlan;
  const state = loadJsonFile<UploadState>(path.resolve(rootDir, WEEK_STATE_PATH), true) as UploadState;
  const planPath = path.resolve(rootDir, WEEK_PLAN_PATH);
  const statePath = path.resolve(rootDir, WEEK_STATE_PATH);
  const adapter = createReportingAdapter(config);

  const syncResult = await adapter.sync({
    rootDir,
    config,
    weekRange,
    plan,
    planPath,
    state,
    statePath
  });

  const summary: SyncWeekCurrentSummary = {
    start_date: weekRange.startDate,
    end_date: weekRange.endDate,
    reporting_backend: syncResult.backend,
    deleted_record_ids: syncResult.deletedRecordIds,
    uploaded_keys: syncResult.uploadedKeys,
    reused_existing_keys: syncResult.reusedExistingKeys,
    output_path: path.resolve(rootDir, WEEK_SYNC_SUMMARY_PATH),
    fetch_entries: fetchSummary.fetched_entries,
    mapped_items: mapSummary.total_output_items,
    allocation: prepareSummary.allocation
  };

  writeJson(path.resolve(rootDir, WEEK_SYNC_SUMMARY_PATH), summary);
  cleanupTransientSyncFiles(rootDir);
  return summary;
}
