import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareUpload } from "../src/uploader.ts";
import type { ReportItem, UploadPlan, UploadPlanItem } from "../src/types.ts";

type FixtureConfigOptions = {
  holidays?: string[];
  standardMinutesPerWorkday?: number;
  taskByActivityCode?: Record<string, Record<string, string>>;
  allocationStartDate?: string;
  allocationEndDate?: string;
};

type DayAllocation = {
  standard: number;
  overtime: number;
  items: UploadPlanItem[];
};

function reportItem(
  id: string,
  workDate: string,
  minutes: number,
  overrides: Partial<ReportItem> = {}
): ReportItem {
  return {
    source_ids: [id],
    entry_type: "ticket_work",
    work_date: workDate,
    start_work_date: workDate,
    finish_work_date: workDate,
    daily_minutes_raw: {
      [workDate]: minutes
    },
    task_id: null,
    duration_minutes_raw: minutes,
    duration_minutes_rounded: minutes,
    target_project_code: "PROJECT",
    activity_code: "Development",
    target_description: id,
    meeting_bucket: null,
    needs_review: false,
    review_reasons: [],
    idempotency_key: id,
    source_snapshot: {},
    ...overrides
  };
}

function multiDayReportItem(id: string, dailyMinutes: Record<string, number>): ReportItem {
  const dates = Object.keys(dailyMinutes).sort();
  const totalMinutes = Object.values(dailyMinutes).reduce((sum, minutes) => sum + minutes, 0);

  return {
    ...reportItem(id, dates[0], totalMinutes),
    start_work_date: dates[0],
    finish_work_date: dates[dates.length - 1],
    daily_minutes_raw: dailyMinutes,
    duration_minutes_raw: totalMinutes,
    duration_minutes_rounded: totalMinutes
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function createFixture(items: ReportItem[], options: FixtureConfigOptions = {}): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "time-reporting-allocation-"));
  writeJson(path.join(rootDir, "config.json"), {
    toggl: {
      required_fields: [],
      field_aliases: {}
    },
    parser_factory: {
      default_parser: "default"
    },
    entry_classification: {},
    rounding: {
      increment_minutes: 30,
      policy: "nearest"
    },
    upload: {
      standard_minutes_per_workday: options.standardMinutesPerWorkday ?? 480,
      working_days: [1, 2, 3, 4, 5],
      holidays: options.holidays ?? [],
      project_option_labels: {
        PROJECT: "PROJECT"
      },
      task_by_activity_code: options.taskByActivityCode ?? {
        PROJECT: {
          Development: "Development",
          Communication: "Communication"
        }
      }
    }
  });
  writeJson(path.join(rootDir, "report_items.json"), items);
  return rootDir;
}

function prepareFixture(items: ReportItem[], options: FixtureConfigOptions = {}): UploadPlan {
  const rootDir = createFixture(items, options);
  prepareUpload({
    rootDir,
    inputPath: "./report_items.json",
    configPath: "./config.json",
    privateConfigPath: "./private.json",
    planPath: "./plan.json",
    statePath: "./state.json",
    allocationStartDate: options.allocationStartDate,
    allocationEndDate: options.allocationEndDate
  });
  return JSON.parse(fs.readFileSync(path.join(rootDir, "plan.json"), "utf8")) as UploadPlan;
}

function allocationByDay(plan: UploadPlan): Record<string, DayAllocation> {
  const result: Record<string, DayAllocation> = {};
  for (const item of plan.items) {
    const day = result[item.work_date] ?? { standard: 0, overtime: 0, items: [] };
    day[item.time_bucket] += item.duration_minutes_rounded;
    day.items.push(item);
    result[item.work_date] = day;
  }
  return result;
}

function descriptions(day: DayAllocation | undefined): string[] {
  return day?.items.map((item) => `${item.time_bucket}:${item.target_description}:${item.duration_minutes_rounded}`) ?? [];
}

describe("upload allocation", () => {
  it("keeps source-day standard hours stable and moves only overflow into free weekly capacity", () => {
    const plan = prepareFixture([
      reportItem("monday", "2026-06-29", 600),
      reportItem("wednesday", "2026-07-01", 480),
      reportItem("friday", "2026-07-03", 420)
    ]);
    const byDay = allocationByDay(plan);

    expect(byDay["2026-06-29"].standard).toBe(480);
    expect(byDay["2026-06-30"].standard).toBe(120);
    expect(byDay["2026-07-01"].standard).toBe(480);
    expect(byDay["2026-07-03"].standard).toBe(420);
    expect(byDay["2026-07-03"].overtime).toBe(0);
    expect(descriptions(byDay["2026-07-03"]).some((description) => description.includes("monday"))).toBe(false);
  });

  it("does not let overflow consume capacity before original entries reserve their own source days", () => {
    const plan = prepareFixture([
      reportItem("monday", "2026-06-29", 600),
      reportItem("tuesday", "2026-06-30", 480),
      reportItem("wednesday", "2026-07-01", 480),
      reportItem("friday", "2026-07-03", 420)
    ]);
    const byDay = allocationByDay(plan);

    expect(byDay["2026-06-30"].standard).toBe(480);
    expect(descriptions(byDay["2026-06-30"]).some((description) => description.includes("monday"))).toBe(false);
    expect(byDay["2026-07-02"].standard).toBe(120);
    expect(descriptions(byDay["2026-07-02"])).toEqual(["standard:monday:120"]);
    expect(byDay["2026-07-03"].standard).toBe(420);
  });

  it("does not move overflow outside an explicit allocation date range", () => {
    const plan = prepareFixture([
      reportItem("wednesday", "2026-07-01", 600),
      reportItem("thursday", "2026-07-02", 480),
      reportItem("friday", "2026-07-03", 480)
    ], {
      allocationStartDate: "2026-07-01",
      allocationEndDate: "2026-07-03"
    });
    const byDay = allocationByDay(plan);

    expect(byDay["2026-06-29"]).toBeUndefined();
    expect(byDay["2026-06-30"]).toBeUndefined();
    expect(byDay["2026-07-01"].standard).toBe(480);
    expect(byDay["2026-07-01"].overtime).toBe(120);
    expect(byDay["2026-07-02"].standard).toBe(480);
    expect(byDay["2026-07-03"].standard).toBe(480);
  });

  it("keeps overflow as overtime on the source day when the week has no free capacity", () => {
    const plan = prepareFixture([
      reportItem("monday", "2026-06-29", 600),
      reportItem("tuesday", "2026-06-30", 480),
      reportItem("wednesday", "2026-07-01", 480),
      reportItem("thursday", "2026-07-02", 480),
      reportItem("friday", "2026-07-03", 480)
    ]);
    const byDay = allocationByDay(plan);

    expect(byDay["2026-06-29"].standard).toBe(480);
    expect(byDay["2026-06-29"].overtime).toBe(120);
    expect(byDay["2026-06-30"].standard).toBe(480);
    expect(byDay["2026-07-03"].standard).toBe(480);
  });

  it("keeps non-working-day source work as overtime unless working-day capacity is free", () => {
    const plan = prepareFixture([
      reportItem("saturday", "2026-07-04", 120),
      reportItem("monday", "2026-06-29", 480),
      reportItem("tuesday", "2026-06-30", 480),
      reportItem("wednesday", "2026-07-01", 480),
      reportItem("thursday", "2026-07-02", 480),
      reportItem("friday", "2026-07-03", 480)
    ]);
    const byDay = allocationByDay(plan);

    expect(byDay["2026-07-04"].standard).toBe(0);
    expect(byDay["2026-07-04"].overtime).toBe(120);
  });

  it("can move non-working-day source work into free working-day capacity", () => {
    const plan = prepareFixture([
      reportItem("saturday", "2026-07-04", 120),
      reportItem("monday", "2026-06-29", 480)
    ]);
    const byDay = allocationByDay(plan);

    expect(byDay["2026-07-04"]).toBeUndefined();
    expect(byDay["2026-06-30"].standard).toBe(120);
    expect(descriptions(byDay["2026-06-30"])).toEqual(["standard:saturday:120"]);
  });

  it("keeps holidays out of standard allocation", () => {
    const plan = prepareFixture([
      reportItem("holiday", "2026-07-02", 120),
      reportItem("monday", "2026-06-29", 480),
      reportItem("tuesday", "2026-06-30", 480),
      reportItem("wednesday", "2026-07-01", 480),
      reportItem("friday", "2026-07-03", 480)
    ], {
      holidays: ["2026-07-02"]
    });
    const byDay = allocationByDay(plan);

    expect(byDay["2026-07-02"].standard).toBe(0);
    expect(byDay["2026-07-02"].overtime).toBe(120);
  });

  it("merges identical final records after allocation", () => {
    const plan = prepareFixture([
      reportItem("same-work-a", "2026-06-29", 60, {
        target_description: "same work",
        idempotency_key: "same-work-a"
      }),
      reportItem("same-work-b", "2026-06-29", 90, {
        target_description: "same work",
        idempotency_key: "same-work-b"
      })
    ]);
    const matchingItems = plan.items.filter((item) => item.work_date === "2026-06-29" && item.target_description === "same work");

    expect(matchingItems).toHaveLength(1);
    expect(matchingItems[0].duration_minutes_rounded).toBe(150);
    expect(matchingItems[0].effort_hours).toBe("2.5");
  });

  it("keeps upload blockers for unresolved target tasks", () => {
    const plan = prepareFixture([
      reportItem("unknown-task", "2026-06-29", 60, {
        activity_code: null
      })
    ], {
      taskByActivityCode: {
        PROJECT: {}
      }
    });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].upload_ready).toBe(false);
    expect(plan.items[0].upload_blockers).toContain("Target task label could not be resolved.");
  });

  it("expands multi-day report items before applying daily allocation rules", () => {
    const plan = prepareFixture([
      multiDayReportItem("range", {
        "2026-06-29": 60,
        "2026-07-01": 120
      })
    ]);
    const byDay = allocationByDay(plan);

    expect(byDay["2026-06-29"].standard).toBe(60);
    expect(byDay["2026-07-01"].standard).toBe(120);
    expect(byDay["2026-06-30"]).toBeUndefined();
  });
});
