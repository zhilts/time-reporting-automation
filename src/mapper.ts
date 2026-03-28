import { getParserByName } from "./parsers";
import type { ParseContext, ReportItem, TogglEntry } from "./types";

export function roundToIncrement(minutes: number, increment: number): number {
  return Math.max(increment, Math.round(minutes / increment) * increment);
}

export function toWorkDate(start: string): string {
  return start.slice(0, 10);
}

export function buildReportItem(entry: TogglEntry, projectCode: string, context: ParseContext): ReportItem {
  const parser = getParserByName(context.parserName);
  const parsed = parser.parseEntry(entry, context);
  const workDate = toWorkDate(entry.start);

  return {
    source_ids: [entry.id],
    entry_type: parsed.entry_type,
    work_date: workDate,
    task_id: parsed.task_id,
    duration_minutes_raw: entry.duration_minutes,
    duration_minutes_rounded: roundToIncrement(entry.duration_minutes, context.incrementMinutes),
    target_project_code: projectCode,
    activity_code: parsed.activity_code,
    target_description: parsed.target_description,
    meeting_bucket: parsed.meeting_bucket,
    needs_review: parsed.needs_review ?? false,
    review_reasons: parsed.review_reasons ?? [],
    idempotency_key: `${entry.id}:${workDate}`,
    source_snapshot: entry,
  };
}

export function toSafeLogSummary(entry: TogglEntry) {
  return {
    source_id_suffix: entry.id.slice(-6),
    project_label: "redacted",
    task_label: entry.task ? "present" : "missing",
    tag_count: entry.tags.length,
    has_description: Boolean(entry.description),
  };
}

// TODO:
// - load YAML config
// - normalize project aliases before parser selection
// - resolve parser names from config using normalized project name
// - group ticket work before rounding policy is finalized
// - group meetings by bucket before rounding
// - overlay private local config on top of generic config
// - keep full-detail exceptions in ignored runtime files only
// - emit report_items.json and exceptions.json
