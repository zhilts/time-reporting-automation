import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Dialog, Page } from "playwright";
import { writeJson } from "../io.ts";
import type { AppConfig, UploadPlanItem } from "../types.ts";
import { markUploadedState, markUploadStateStatus } from "./state.ts";
import type { ReportingAdapter, ReportingResetRequest, ReportingResetResult, ReportingSyncRequest, ReportingSyncResult } from "./types.ts";

type ExistingRecord = {
  recordId: string;
  text: string;
};

async function openConfiguredContext(rootDir: string, config: NonNullable<AppConfig["browser_launch"]>): Promise<BrowserContext> {
  const playwrightModule = await import("playwright");
  if (!config.user_data_dir) {
    throw new Error("browser_launch.user_data_dir is required.");
  }

  const userDataDir = path.isAbsolute(config.user_data_dir)
    ? config.user_data_dir
    : path.resolve(rootDir, config.user_data_dir);

  fs.mkdirSync(userDataDir, { recursive: true });

  try {
    return await playwrightModule.chromium.launchPersistentContext(userDataDir, {
      channel: config.channel ?? "chrome",
      headless: config.headless ?? false,
      executablePath: config.executable_path ?? undefined,
      args: config.profile_directory
        ? [`--profile-directory=${config.profile_directory}`, ...(config.args ?? [])]
        : (config.args ?? [])
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ProcessSingleton") || message.includes("SingletonLock")) {
      throw new Error(
        `Automation browser profile is locked: ${userDataDir}. ` +
        "Close the existing automation Chrome window or remove the stale lock, then rerun sync:week-current."
      );
    }

    throw error;
  }
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
  await addLink.click({ noWaitAfter: true, timeout: 60_000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  await page.waitForSelector("#listBoxProjectUuid", { timeout: 60_000 });
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

function readPlaywrightConfig(config: AppConfig): { browserLaunch: NonNullable<AppConfig["browser_launch"]>; targetUrl: string } {
  const browserLaunch = config.browser_launch;
  const targetUrl = config.upload?.target_page_url;
  if (!browserLaunch?.enabled || !targetUrl) {
    throw new Error("Playwright reporting backend requires browser_launch.enabled and upload.target_page_url.");
  }

  return { browserLaunch, targetUrl };
}

export const playwrightReportingAdapter: ReportingAdapter = {
  backend: "playwright",

  async reset({ rootDir, config }: ReportingResetRequest): Promise<ReportingResetResult> {
    const { browserLaunch, targetUrl } = readPlaywrightConfig(config);
    const context = await openConfiguredContext(rootDir, browserLaunch);
    const deletedRecordIds: string[] = [];

    try {
      const page = await resolveTargetPage(context, targetUrl);
      await page.bringToFront().catch(() => {});
      await waitForStablePage(page);

      const existingRecords = await collectExistingRecords(page);
      console.error(`[reset:playwright] deleting ${existingRecords.length} records`);

      for (const record of existingRecords) {
        await deleteRecord(page, record.recordId);
        deletedRecordIds.push(record.recordId);
      }
    } finally {
      await context.close().catch(() => {});
    }

    return {
      backend: "playwright",
      deletedRecordIds
    };
  },

  async sync({ rootDir, config, weekRange, plan, state, statePath }: ReportingSyncRequest): Promise<ReportingSyncResult> {
    const { browserLaunch, targetUrl } = readPlaywrightConfig(config);
    const targetItems = plan.items.filter((item) => item.upload_ready);
    const context = await openConfiguredContext(rootDir, browserLaunch);
    const uploadedKeys: string[] = [];
    const reusedExistingKeys: string[] = [];

    try {
      const page = await resolveTargetPage(context, targetUrl);
      await page.bringToFront().catch(() => {});
      await waitForStablePage(page);

      const existingRecords = await collectExistingRecords(page);
      for (const item of targetItems) {
        if (!matchesExistingRecord(item, existingRecords)) {
          continue;
        }

        reusedExistingKeys.push(item.idempotency_key);
        writeJson(statePath, markUploadStateStatus(state, item.idempotency_key, "uploaded"));
      }

      console.error(`[sync:playwright] week ${weekRange.startDate}..${weekRange.endDate}`);
      console.error(`[sync:playwright] reuse ${reusedExistingKeys.length}, upload ${targetItems.length - reusedExistingKeys.length}`);

      for (const item of targetItems) {
        if (reusedExistingKeys.includes(item.idempotency_key)) {
          continue;
        }

        try {
          await addRecord(page, item);
          uploadedKeys.push(item.idempotency_key);
          writeJson(statePath, markUploadStateStatus(state, item.idempotency_key, "uploaded"));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          writeJson(statePath, markUploadStateStatus(state, item.idempotency_key, "failed", message));
          throw error;
        }
      }
    } finally {
      await context.close().catch(() => {});
    }

    writeJson(statePath, markUploadedState(state, [...reusedExistingKeys, ...uploadedKeys]));

    return {
      backend: "playwright",
      uploadedKeys,
      reusedExistingKeys,
      deletedRecordIds: []
    };
  }
};
