export type TogglEntry = {
  id: string;
  start: string;
  duration_minutes: number;
  client: string;
  project: string;
  task: string;
  tags: string[];
  description?: string;
};

export type EntryType = "ticket_work" | "meeting" | "other";

export type ParsedMeaning = {
  entry_type: EntryType;
  task_id: string | null;
  activity_code: string | null;
  target_description: string;
  meeting_bucket: string | null;
  needs_review?: boolean;
  review_reasons?: string[];
};

export type ReportItem = {
  source_ids: string[];
  entry_type: EntryType;
  work_date: string;
  task_id: string | null;
  duration_minutes_raw: number;
  duration_minutes_rounded: number;
  target_project_code: string;
  activity_code: string | null;
  target_description: string;
  meeting_bucket: string | null;
  needs_review: boolean;
  review_reasons: string[];
  idempotency_key: string;
  source_snapshot: Record<string, unknown>;
};

export type ParseContext = {
  normalizedProjectName: string;
  incrementMinutes: number;
  parserName: string;
  redactedLogging?: boolean;
};
