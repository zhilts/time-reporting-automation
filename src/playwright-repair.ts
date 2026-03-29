import type { BrowserContext, Dialog, Page } from "playwright";
import path from "node:path";
import { loadConfig, loadJsonFile } from "./config.ts";
import { writeJson } from "./io.ts";
import type { AppConfig, UploadPlan, UploadPlanItem, UploadState } from "./types.ts";

type RepairWeekOptions = {
  rootDir: string;
  configPath?: string;
  privateConfigPath?: string;
  planPath?: string;
  statePath?: string;
  outputPath?: string;
};

type ExistingRecord = {
  recordId: string;
  text: string;
};

type RepairWeekSummary = {
  deleted_record_ids: string[];
  uploaded_keys: string[];
  reused_existing_keys: string[];
  output_path: string;
};

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

function buildExpectedRowText(item: UploadPlanItem): string {
  const issuePart = item.task_id ? `${item.task_id} ` : "";
  return `${item.project_label} ${item.task_label} ${item.effort_hours} ${issuePart}${item.target_description} ${item.start_date}`;
}

function matchesExistingRecord(item: UploadPlanItem, existingRecords: ExistingRecord[]): boolean {
  const fragments = [
    item.project_label,
    item.task_label ?? "",
    item.effort_hours,
    item.target_description,
    item.start_date
  ].filter(Boolean);

  return existingRecords.some((record) => fragments.every((fragment) => record.text.includes(fragment)));
}

function isWrongAggregatedCommunication(record: ExistingRecord): boolean {
  return record.text.includes("HDAA Communication")
    && record.text.includes("Syncs/Dailies")
    && (
      record.text.includes("23.03.2026")
      || record.text.includes("24.03.2026")
      || record.text.includes("25.03.2026")
      || record.text.includes("26.03.2026")
    );
}

async function deleteRecord(page: Page, recordId: string): Promise<void> {
  console.error(`[repair] deleting record ${recordId}`);
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

  console.error(`[repair] adding ${item.work_date} ${item.task_label} ${item.effort_hours} ${item.target_description}`);
  await openAddForm(page);
  await page.selectOption("#listBoxProjectUuid", { label: item.project_label });
  await waitForTaskOption(page, item.task_label);
  await page.selectOption("#listBoxIssueCode", { label: item.task_label });

  await page.fill("#effortRecordBugNumber", item.task_id ?? "");
  await page.fill("#effortRecordEffort", item.effort_hours);
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

  console.error(`[repair] added ${item.idempotency_key}`);
}

function updateUploadStateFile(state: UploadState, uploadedKeys: string[]): UploadState {
  const uploadedSet = new Set(uploadedKeys);
  const now = new Date().toISOString();

  for (const item of state.items) {
    if (uploadedSet.has(item.idempotency_key)) {
      item.status = "uploaded";
      item.last_error = null;
      item.updated_at = now;
    }
  }

  state.updated_at = now;
  return state;
}

export async function repairWeekCurrent({
  rootDir,
  configPath = "./config/mapping.json",
  privateConfigPath = "./config/private.mapping.json",
  planPath = "./runtime/state/upload-plan.week-current.json",
  statePath = "./runtime/state/upload-state.week-current.json",
  outputPath = "./runtime/output/week-current/repair-summary.json"
}: RepairWeekOptions): Promise<RepairWeekSummary> {
  const config = loadConfig(rootDir, configPath, privateConfigPath);
  const browserLaunch = config.browser_launch;
  const targetUrl = browserLaunch?.target_url ?? config.upload?.target_page_url;
  if (!browserLaunch?.enabled || !targetUrl) {
    throw new Error("Browser launch is not configured.");
  }

  const plan = loadJsonFile<UploadPlan>(path.resolve(rootDir, planPath), true) as UploadPlan;
  const state = loadJsonFile<UploadState>(path.resolve(rootDir, statePath), true) as UploadState;
  const communicationItems = plan.items.filter((item) => item.task_label === "Communication");
  const existingCorrectItems = plan.items.filter((item) => item.task_label !== "Communication");

  const context = await openConfiguredContext(browserLaunch);
  const deletedRecordIds: string[] = [];
  const uploadedKeys: string[] = [];
  const reusedExistingKeys: string[] = [];

  try {
    const page = await resolveTargetPage(context, targetUrl);
    await page.bringToFront().catch(() => {});
    await waitForStablePage(page);

    const existingBeforeDelete = await collectExistingRecords(page);
    const wrongRecords = existingBeforeDelete.filter(isWrongAggregatedCommunication);
    console.error(`[repair] wrong aggregated records: ${wrongRecords.length}`);

    for (const record of wrongRecords) {
      await deleteRecord(page, record.recordId);
      deletedRecordIds.push(record.recordId);
    }

    const existingAfterDelete = await collectExistingRecords(page);
    for (const item of existingCorrectItems) {
      if (matchesExistingRecord(item, existingAfterDelete)) {
        reusedExistingKeys.push(item.idempotency_key);
      }
    }
    console.error(`[repair] reused existing non-communication items: ${reusedExistingKeys.length}`);

    for (const item of communicationItems) {
      await addRecord(page, item);
      uploadedKeys.push(item.idempotency_key);
    }

    const finalUploadedKeys = [...reusedExistingKeys, ...uploadedKeys];
    const updatedState = updateUploadStateFile(state, finalUploadedKeys);
    writeJson(path.resolve(rootDir, statePath), updatedState);

    const summary: RepairWeekSummary = {
      deleted_record_ids: deletedRecordIds,
      uploaded_keys: uploadedKeys,
      reused_existing_keys: reusedExistingKeys,
      output_path: path.resolve(rootDir, outputPath)
    };

    writeJson(path.resolve(rootDir, outputPath), summary);
    return summary;
  } finally {
    await context.close().catch(() => {});
  }
}
