import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Dialog, Page } from "playwright";
import { loadConfig, loadJsonFile } from "./config.ts";
import { fetchAndStoreTogglEntries } from "./toggl-api.ts";
import { runMapper } from "./mapper.ts";
import { prepareUpload } from "./uploader.ts";
import { writeJson } from "./io.ts";
import type { AppConfig, MapperSummary, UploadAllocationSummary, UploadPlan, UploadPlanItem, UploadState } from "./types.ts";

const WEEK_FETCH_PATH = "./runtime/input/toggl.time_entries.json";
const WEEK_OUTPUT_DIR = "./runtime/output/week-current";
const WEEK_REPORT_PATH = "./runtime/output/week-current/report_items.json";
const WEEK_PLAN_PATH = "./runtime/state/upload-plan.week-current.json";
const WEEK_STATE_PATH = "./runtime/state/upload-state.week-current.json";
const WEEK_SYNC_SUMMARY_PATH = "./runtime/output/week-current/sync-summary.json";
const LEGACY_OUTPUT_DIR = "./runtime/output/latest";
const LEGACY_PLAN_PATH = "./runtime/state/upload-plan.json";
const LEGACY_STATE_PATH = "./runtime/state/upload-state.json";

type WeekRange = {
  startDate: string;
  endDate: string;
};

type ExistingRecord = {
  recordId: string;
  text: string;
};

export type SyncWeekCurrentSummary = {
  start_date: string;
  end_date: string;
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

function updateUploadStateFile(state: UploadState, uploadedKeys: string[]): UploadState {
  const uploadedSet = new Set(uploadedKeys);
  const now = new Date().toISOString();

  for (const item of state.items) {
    if (uploadedSet.has(item.idempotency_key)) {
      item.status = "uploaded";
      item.last_error = null;
      item.updated_at = now;
      continue;
    }

    item.status = "pending";
    item.last_error = null;
    item.updated_at = null;
  }

  state.updated_at = now;
  return state;
}

function setUploadStateStatus(
  state: UploadState,
  idempotencyKey: string,
  status: "pending" | "uploaded" | "failed" | "skipped" | "blocked",
  lastError: string | null = null
): UploadState {
  const now = new Date().toISOString();
  const targetItem = state.items.find((item) => item.idempotency_key === idempotencyKey);
  if (!targetItem) {
    return state;
  }

  targetItem.status = status;
  targetItem.last_error = lastError;
  targetItem.updated_at = now;
  state.updated_at = now;
  return state;
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

async function openConfiguredContext(config: NonNullable<AppConfig["browser_launch"]>): Promise<BrowserContext> {
  const playwrightModule = await import("playwright");
  if (!config.user_data_dir) {
    throw new Error("browser_launch.user_data_dir is required.");
  }

  return playwrightModule.chromium.launchPersistentContext(config.user_data_dir, {
    channel: config.channel ?? "chrome",
    headless: config.headless ?? false,
    executablePath: config.executable_path ?? undefined,
    args: config.profile_directory
      ? [`--profile-directory=${config.profile_directory}`, ...(config.args ?? [])]
      : (config.args ?? [])
  });
}

async function resolveTargetPage(context: BrowserContext, targetUrl: string): Promise<Page> {
  for (const page of context.pages()) {
    if (page.url().startsWith(targetUrl)) {
      return page;
    }
  }

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  return page;
}

async function waitForStablePage(page: Page, ms = 3_000): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function collectExistingRecords(page: Page): Promise<ExistingRecord[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("[title='Delete record']"))
      .map((node) => {
        const onclick = node.getAttribute("onclick") ?? "";
        const match = onclick.match(/doDelete\('([^']+)'\)/);
        const recordId = match ? match[1] : null;

        let container: Element | null = node;
        while (container && container.tagName !== "TR") {
          container = container.parentElement;
        }

        const text = (container?.textContent ?? "").replace(/\s+/g, " ").trim();
        return recordId ? { recordId, text } : null;
      })
      .filter(Boolean) as ExistingRecord[]
  );
}

function matchesExistingRecord(item: UploadPlanItem, existingRecords: ExistingRecord[]): boolean {
  const fragments = [
    item.project_label,
    item.task_label ?? "",
    item.effort_hours,
    item.target_description,
    item.start_date,
    item.finish_date
  ].filter(Boolean);

  return existingRecords.some((record) => fragments.every((fragment) => record.text.includes(fragment)));
}

async function deleteRecord(page: Page, recordId: string): Promise<void> {
  const dialogHandler = async (dialog: Dialog) => {
    await dialog.accept();
  };

  page.once("dialog", dialogHandler);
  await page.evaluate((targetRecordId) => {
    const deleteControl = Array.from(document.querySelectorAll("[title='Delete record']")).find((node) =>
      (node.getAttribute("onclick") ?? "").includes(targetRecordId)
    ) as HTMLElement | undefined;

    if (!deleteControl) {
      throw new Error(`Delete control not found for record ${targetRecordId}`);
    }

    deleteControl.click();
  }, recordId);

  await waitForStablePage(page, 6_000);
}

async function waitForTaskOption(page: Page, label: string): Promise<void> {
  await page.waitForFunction((targetLabel) => {
    const select = document.getElementById("listBoxIssueCode") as HTMLSelectElement | null;
    if (!select) {
      return false;
    }

    return Array.from(select.options).some((option) => option.textContent?.trim() === targetLabel);
  }, label, { timeout: 30_000 });
}

async function openAddForm(page: Page): Promise<void> {
  const addLink = page.locator("[title='Add new record']").first();
  await addLink.click();
  await page.waitForSelector("#listBoxProjectUuid", { timeout: 30_000 });
  await page.waitForTimeout(1_500);
}

async function addRecord(page: Page, item: UploadPlanItem): Promise<void> {
  if (!item.task_label) {
    throw new Error(`Missing task label for ${item.idempotency_key}`);
  }

  await openAddForm(page);
  await page.selectOption("#listBoxProjectUuid", { label: item.project_label });
  await waitForTaskOption(page, item.task_label);
  await page.selectOption("#listBoxIssueCode", { label: item.task_label });
  await page.fill("#effortRecordBugNumber", item.task_id ?? "");
  if (item.time_bucket === "overtime") {
    await page.fill("#effortRecordEffort", "0");
    await page.fill("#effortRecordEffortOvertime", item.effort_hours);
  } else {
    await page.fill("#effortRecordEffort", item.effort_hours);
    await page.fill("#effortRecordEffortOvertime", "0");
  }
  await page.fill("#effortRecordDescription", item.target_description);
  await page.evaluate(({ started, finished }) => {
    const setDateValue = (selector: string, value: string) => {
      const input = document.querySelector(selector) as HTMLInputElement | null;
      if (!input) {
        throw new Error(`Missing date input ${selector}`);
      }

      input.removeAttribute("readonly");
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };

    setDateValue("#effortRecordStarted", started);
    setDateValue("#effortRecordFinished", finished);
  }, { started: item.start_date, finished: item.finish_date });

  const dialogMessages: string[] = [];
  const dialogHandler = async (dialog: Dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  };

  page.on("dialog", dialogHandler);
  try {
    await page.locator("input[value='SAVE']").click();
    await waitForStablePage(page, 8_000);
  } finally {
    page.off("dialog", dialogHandler);
  }

  if (dialogMessages.length > 0) {
    throw new Error(dialogMessages.join(" | "));
  }
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
  const weekRange = {
    startDate: startDate ?? getCurrentWeekRange().startDate,
    endDate: endDate ?? getCurrentWeekRange().endDate
  };
  const config = loadConfig(rootDir, configPath, privateConfigPath);
  const browserLaunch = config.browser_launch;
  const targetUrl = config.upload?.target_page_url;
  if (!browserLaunch?.enabled || !targetUrl) {
    throw new Error("Browser launch is not configured.");
  }

  const context = await openConfiguredContext(browserLaunch);
  const deletedRecordIds: string[] = [];

  try {
    const page = await resolveTargetPage(context, targetUrl);
    await page.bringToFront().catch(() => {});
    await waitForStablePage(page);

    const existingRecords = await collectExistingRecords(page);
    console.error(`[reset] deleting ${existingRecords.length} records`);

    for (const record of existingRecords) {
      await deleteRecord(page, record.recordId);
      deletedRecordIds.push(record.recordId);
    }
  } finally {
    await context.close().catch(() => {});
  }

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
    start_date: weekRange.startDate,
    end_date: weekRange.endDate,
    deleted_record_ids: deletedRecordIds,
    removed_files: removedFiles,
    removed_directories: [...new Set(removedDirectories)]
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
  const weekRange = {
    startDate: startDate ?? getCurrentWeekRange().startDate,
    endDate: endDate ?? getCurrentWeekRange().endDate
  };

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

  const browserLaunch = config.browser_launch;
  const targetUrl = config.upload?.target_page_url;
  if (!browserLaunch?.enabled || !targetUrl) {
    throw new Error("Browser launch is not configured.");
  }

  const plan = loadJsonFile<UploadPlan>(path.resolve(rootDir, WEEK_PLAN_PATH), true) as UploadPlan;
  const state = loadJsonFile<UploadState>(path.resolve(rootDir, WEEK_STATE_PATH), true) as UploadState;
  const targetItems = plan.items.filter((item) => item.upload_ready);
  const context = await openConfiguredContext(browserLaunch);
  const uploadedKeys: string[] = [];
  const reusedExistingKeys: string[] = [];
  const absoluteStatePath = path.resolve(rootDir, WEEK_STATE_PATH);

  try {
    const page = await resolveTargetPage(context, targetUrl);
    await page.bringToFront().catch(() => {});
    await waitForStablePage(page);

    const existingRecords = await collectExistingRecords(page);
    for (const item of targetItems) {
      if (matchesExistingRecord(item, existingRecords)) {
        reusedExistingKeys.push(item.idempotency_key);
        writeJson(absoluteStatePath, setUploadStateStatus(state, item.idempotency_key, "uploaded"));
      }
    }

    console.error(`[sync] week ${weekRange.startDate}..${weekRange.endDate}`);
    console.error(`[sync] reuse ${reusedExistingKeys.length}, upload ${targetItems.length - reusedExistingKeys.length}`);
    for (const item of targetItems) {
      if (reusedExistingKeys.includes(item.idempotency_key)) {
        continue;
      }

      try {
        await addRecord(page, item);
        uploadedKeys.push(item.idempotency_key);
        writeJson(absoluteStatePath, setUploadStateStatus(state, item.idempotency_key, "uploaded"));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeJson(absoluteStatePath, setUploadStateStatus(state, item.idempotency_key, "failed", message));
        throw error;
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  const finalUploadedKeys = [...reusedExistingKeys, ...uploadedKeys];
  writeJson(absoluteStatePath, updateUploadStateFile(state, finalUploadedKeys));

  const summary: SyncWeekCurrentSummary = {
    start_date: weekRange.startDate,
    end_date: weekRange.endDate,
    deleted_record_ids: [],
    uploaded_keys: uploadedKeys,
    reused_existing_keys: reusedExistingKeys,
    output_path: path.resolve(rootDir, WEEK_SYNC_SUMMARY_PATH),
    fetch_entries: fetchSummary.fetched_entries,
    mapped_items: mapSummary.total_output_items,
    allocation: prepareSummary.allocation
  };

  writeJson(path.resolve(rootDir, WEEK_SYNC_SUMMARY_PATH), summary);
  removeFileIfExists(path.resolve(rootDir, WEEK_FETCH_PATH));
  removeFileIfExists(path.resolve(rootDir, WEEK_PLAN_PATH));
  removeFileIfExists(path.resolve(rootDir, WEEK_REPORT_PATH));
  removeFileIfExists(path.resolve(rootDir, path.join(WEEK_OUTPUT_DIR, "report_items.redacted.json")));
  removeFileIfExists(path.resolve(rootDir, path.join(WEEK_OUTPUT_DIR, "exceptions.json")));
  removeFileIfExists(path.resolve(rootDir, path.join(WEEK_OUTPUT_DIR, "run-summary.json")));
  const removedDirectories: string[] = [];
  const runtimeRoot = path.resolve(rootDir, "./runtime");
  pruneEmptyDirectory(path.resolve(rootDir, "./runtime/input"), runtimeRoot, removedDirectories);
  return summary;
}
