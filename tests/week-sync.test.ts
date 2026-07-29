import { describe, expect, it } from "vitest";
import { findStaleExistingRecords, type ExistingRecord } from "../src/week-sync.ts";
import type { UploadPlanItem } from "../src/types.ts";

function uploadItem(overrides: Partial<UploadPlanItem> = {}): UploadPlanItem {
  return {
    idempotency_key: "planned",
    source_report_idempotency_key: "source",
    time_bucket: "standard",
    target_project_code: "PROJECT",
    project_label: "PROJECT",
    target_description: "Development",
    activity_code: "Development",
    task_id: "TASK-1",
    task_label: "Development",
    duration_minutes_rounded: 60,
    effort_hours: "1",
    work_date: "2026-07-29",
    start_date: "29.07.2026",
    finish_date: "29.07.2026",
    entry_type: "ticket_work",
    upload_ready: true,
    upload_blockers: [],
    ...overrides
  };
}

function existingRecord(recordId: string, text: string): ExistingRecord {
  return { recordId, text };
}

describe("findStaleExistingRecords", () => {
  it("keeps records matching the current upload plan", () => {
    const stale = findStaleExistingRecords([
      uploadItem()
    ], [
      existingRecord("existing", "PROJECT Development TASK-1 1 Development 29.07.2026 29.07.2026")
    ]);

    expect(stale).toEqual([]);
  });

  it("marks existing records absent from the current upload plan as stale", () => {
    const stale = findStaleExistingRecords([
      uploadItem({ effort_hours: "1", target_description: "Current work" })
    ], [
      existingRecord("old", "PROJECT Development TASK-1 1 Old work 29.07.2026 29.07.2026")
    ]);

    expect(stale.map((record) => record.recordId)).toEqual(["old"]);
  });

  it("does not match a standard record as overtime", () => {
    const stale = findStaleExistingRecords([
      uploadItem({ time_bucket: "overtime", effort_hours: "1" })
    ], [
      existingRecord("standard", "PROJECT Development TASK-1 1 Development 29.07.2026 29.07.2026")
    ]);

    expect(stale.map((record) => record.recordId)).toEqual(["standard"]);
  });

  it("keeps an existing overtime record when the row text exposes overtime", () => {
    const stale = findStaleExistingRecords([
      uploadItem({ time_bucket: "overtime", effort_hours: "1" })
    ], [
      existingRecord("overtime", "PROJECT Development TASK-1 Overtime 1 Development 29.07.2026 29.07.2026")
    ]);

    expect(stale).toEqual([]);
  });
});
