export type PrimitiveRecord = Record<string, unknown>;

export type TogglEntry = {
  id: string;
  start: string;
  duration_minutes: number;
  client: string;
  project: string;
  task: string;
  tags: string[];
  description: string;
};

export type ReportItem = {
  source_ids: string[];
  entry_type: "ticket_work" | "meeting" | "other";
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
  source_snapshot: PrimitiveRecord;
};

export type ParsedEntry = {
  entryType: ReportItem["entry_type"];
  taskId: string | null;
  activityCode: string | null;
  targetDescription: string;
  meetingBucket: string | null;
  needsReview: boolean;
  reviewReasons: string[];
};

export type TogglConfig = {
  required_fields: string[];
  field_aliases: Record<string, string[]>;
  tags_separator?: string;
};

export type ParserFactoryConfig = {
  default_parser: string;
  project_parser_map?: Record<string, string>;
  project_aliases?: Record<string, string>;
};

export type EntryClassificationConfig = {
  meeting_task_names?: string[];
  meeting_description_patterns?: string[];
  ticket_id_patterns?: string[];
  ticket_id_sources?: Array<"task" | "description">;
};

export type RoundingConfig = {
  increment_minutes?: number;
  policy?: "nearest" | "ceil" | "floor";
};

export type AppConfig = {
  toggl: TogglConfig;
  toggl_api?: {
    api_token?: string;
    default_start_date?: string;
    default_end_date?: string;
  };
  parser_factory: ParserFactoryConfig;
  project_code_map?: Record<string, string>;
  activity_description_tags?: Record<string, string>;
  meeting_bucket_tags?: Record<string, string>;
  entry_classification: EntryClassificationConfig;
  rounding: RoundingConfig;
  rules?: Record<string, string>;
  privacy?: Record<string, unknown>;
};

export type ParserContext = {
  normalizedProjectName: string;
  parserName: string;
  redactedLogging: boolean;
  meetingTaskNames: string[];
  meetingDescriptionPatterns: string[];
  ticketIdRegexes: RegExp[];
  ticketIdSources: Array<"task" | "description">;
  meetingBucketTags: Record<string, string>;
  activityDescriptionTags: Record<string, string>;
  incrementMinutes: number;
  roundingPolicy: "nearest" | "ceil" | "floor";
};

export type ProjectParser = {
  name: string;
  parseEntry(entry: TogglEntry, context: ParserContext): ParsedEntry;
};

export type MapperRunOptions = {
  rootDir: string;
  inputPath: string;
  outputDir: string;
  configPath?: string;
  privateConfigPath?: string;
  redact?: boolean;
};

export type MapperSummary = {
  input_path: string;
  redacted_logging: boolean;
  parser_usage: Record<string, number>;
  total_output_items: number;
  total_exception_items: number;
  total_rounded_minutes: number;
};

export type FetchOptions = {
  apiToken: string | null;
  startDate?: string | null;
  endDate?: string | null;
  before?: string | null;
  since?: string | null;
};

export type FetchAndStoreOptions = FetchOptions & {
  rootDir: string;
  outputPath: string;
};

export type FetchSummary = {
  output_path: string;
  start_date: string | null;
  end_date: string | null;
  before: string | null;
  since: string | null;
  fetched_entries: number;
  distinct_projects: number;
};

export type CliArgs = Record<string, string | boolean | string[] | undefined> & {
  _: string[];
};
