import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, normalizeProjectName } from "./config.ts";
import { fetchTogglTimeEntries } from "./toggl-api.ts";
import { getParserByName } from "./parsers/index.ts";
import type { AppConfig, ParserContext, TogglEntry } from "./types.ts";

type TaskMatcher = {
  match_type: "exact" | "prefix" | "includes" | "regex";
  pattern: string;
  task_label: string;
};

type CheckEntriesOptions = {
  rootDir: string;
  configPath?: string;
  privateConfigPath?: string;
  date?: string;
};

type CheckedEntry = {
  id: string;
  local_date: string;
  local_time: string;
  project: string;
  task: string;
  tags: string[];
  description: string;
  duration_minutes: number;
  is_running: boolean;
  in_scope: boolean;
  parser: string;
  parsed: {
    entry_type: string;
    task_id: string | null;
    activity_code: string | null;
    target_description: string;
    needs_review: boolean;
    review_reasons: string[];
  };
  target_project_code: string | null;
  task_label: string | null;
  upload_ready: boolean;
};

type CheckEntriesSummary = {
  date: string;
  count: number;
  entries: CheckedEntry[];
};

function getTodayInWarsaw(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toWarsawLocalParts(start: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(start));

  const valueByType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${valueByType.year}-${valueByType.month}-${valueByType.day}`,
    time: `${valueByType.hour}:${valueByType.minute}`
  };
}

function toMinutesFromDurationSeconds(durationSeconds: unknown): number {
  const numericDuration = Number(durationSeconds ?? 0);
  if (!Number.isFinite(numericDuration) || numericDuration < 0) {
    return 0;
  }

  return Math.max(1, Math.round(numericDuration / 60));
}

function toNormalizedEntry(rawEntry: Record<string, unknown>): TogglEntry {
  const durationSeconds = Number(rawEntry.duration ?? 0);
  return {
    id: String(rawEntry.id),
    start: String(rawEntry.start ?? ""),
    duration_minutes: toMinutesFromDurationSeconds(rawEntry.duration),
    is_running: Number.isFinite(durationSeconds) && durationSeconds < 0,
    client: String(rawEntry.client_name ?? ""),
    project: String(rawEntry.project_name ?? ""),
    task: String(rawEntry.task_name ?? ""),
    tags: Array.isArray(rawEntry.tags) ? rawEntry.tags.map((tag) => String(tag)) : [],
    description: String(rawEntry.description ?? "")
  };
}

function createParserContext(config: AppConfig, normalizedProjectName: string, parserName: string): ParserContext {
  return {
    normalizedProjectName,
    parserName,
    redactedLogging: false,
    meetingTaskNames: config.entry_classification.meeting_task_names ?? [],
    meetingDescriptionPatterns: config.entry_classification.meeting_description_patterns ?? [],
    meetingDescriptionMode: config.entry_classification.meeting_description_mode ?? "bucket",
    ticketIdRegexes: (config.entry_classification.ticket_id_patterns ?? []).map((pattern) => new RegExp(pattern)),
    ticketIdSources: config.entry_classification.ticket_id_sources ?? ["task"],
    meetingBucketTags: config.meeting_bucket_tags ?? {},
    activityDescriptionTags: config.activity_description_tags ?? {},
    incrementMinutes: config.rounding.increment_minutes ?? 30,
    roundingPolicy: config.rounding.policy ?? "nearest"
  };
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

function resolveTaskLabel(
  targetProjectCode: string | null,
  activityCode: string | null,
  targetDescription: string,
  config: AppConfig
): string | null {
  if (!targetProjectCode) {
    return null;
  }

  const uploadConfig = config.upload ?? {};
  if (activityCode) {
    const mappedActivityLabel = uploadConfig.task_by_activity_code?.[targetProjectCode]?.[activityCode];
    if (mappedActivityLabel) {
      return mappedActivityLabel;
    }
  }

  const matchers = uploadConfig.task_matchers_by_project?.[targetProjectCode] ?? [];
  for (const matcher of matchers) {
    if (matchDescription(targetDescription, matcher)) {
      return matcher.task_label;
    }
  }

  if (activityCode) {
    return activityCode;
  }

  return uploadConfig.default_task_by_project?.[targetProjectCode] ?? null;
}

export async function checkEntries({
  rootDir,
  configPath = "./config/mapping.json",
  privateConfigPath = "./config/private.mapping.json",
  date
}: CheckEntriesOptions): Promise<CheckEntriesSummary> {
  const targetDate = date ?? getTodayInWarsaw();
  const config = loadConfig(rootDir, configPath, privateConfigPath);
  const apiToken = process.env.TOGGL_API_TOKEN ?? config.toggl_api?.api_token ?? null;
  const rawEntries = await fetchTogglTimeEntries({
    apiToken,
    startDate: shiftDate(targetDate, -1),
    endDate: shiftDate(targetDate, 1)
  });

  const normalizedEntries = rawEntries
    .map((entry) => toNormalizedEntry(entry as Record<string, unknown>))
    .map((entry) => {
      const local = toWarsawLocalParts(entry.start);
      return {
        entry,
        localDate: local.date,
        localTime: local.time
      };
    })
    .filter(({ localDate }) => localDate === targetDate)
    .sort((left, right) => left.localTime.localeCompare(right.localTime));

  const checkedEntries: CheckedEntry[] = normalizedEntries.map(({ entry, localDate, localTime }) => {
    const normalizedProjectName = normalizeProjectName(entry.project, config.parser_factory.project_aliases ?? {});
    const inScope = !config.scope?.include_projects?.length || config.scope.include_projects.includes(normalizedProjectName);
    const parserName =
      config.parser_factory.project_parser_map?.[normalizedProjectName] ?? config.parser_factory.default_parser ?? "default";
    const parser = getParserByName(parserName);
    const parsed = parser.parseEntry(entry, createParserContext(config, normalizedProjectName, parserName));
    const targetProjectCode = config.project_code_map?.[normalizedProjectName] ?? null;
    const taskLabel = resolveTaskLabel(targetProjectCode, parsed.activityCode, parsed.targetDescription, config);

    return {
      id: entry.id,
      local_date: localDate,
      local_time: localTime,
      project: entry.project || "<empty>",
      task: entry.task || "<empty>",
      tags: entry.tags,
      description: entry.description || "<empty>",
      duration_minutes: entry.duration_minutes,
      is_running: Boolean(entry.is_running),
      in_scope: inScope,
      parser: parserName,
      parsed: {
        entry_type: parsed.entryType,
        task_id: parsed.taskId,
        activity_code: parsed.activityCode,
        target_description: parsed.targetDescription,
        needs_review: parsed.needsReview,
        review_reasons: parsed.reviewReasons
      },
      target_project_code: targetProjectCode,
      task_label: taskLabel,
      upload_ready: inScope && !entry.is_running && !parsed.needsReview && Boolean(targetProjectCode && taskLabel)
    };
  });

  return {
    date: targetDate,
    count: checkedEntries.length,
    entries: checkedEntries
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

if (process.argv[1] === __filename) {
  const dateArgIndex = process.argv.indexOf("--date");
  const date = dateArgIndex >= 0 ? process.argv[dateArgIndex + 1] : undefined;
  const summary = await checkEntries({ rootDir, date });
  console.log(JSON.stringify(summary, null, 2));
}
