import crypto from "node:crypto";
import path from "node:path";
import { getParserByName } from "./parsers/index.js";
import { ensureDirectory, readInputFile, writeJson } from "./io.js";
import { loadConfig, normalizeProjectName } from "./config.js";

function parseMinutes(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  const stringValue = String(value ?? "").trim();
  if (/^\d+$/.test(stringValue)) {
    return Number(stringValue);
  }

  const match = stringValue.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] ?? "0");
    return hours * 60 + minutes + Math.round(seconds / 60);
  }

  throw new Error(`Unsupported duration value: ${stringValue}`);
}

function pickField(record, aliases) {
  for (const alias of aliases) {
    if (record[alias] !== undefined && record[alias] !== null && String(record[alias]).trim() !== "") {
      return record[alias];
    }
  }
  return undefined;
}

function normalizeTags(rawTags, separator) {
  if (Array.isArray(rawTags)) {
    return rawTags.map((tag) => String(tag).trim()).filter(Boolean);
  }

  return String(rawTags ?? "")
    .split(separator)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeRecords(rawEntries, config) {
  const aliases = config.toggl.field_aliases;
  const separator = config.toggl.tags_separator ?? ",";

  return rawEntries.map((record, index) => {
    const entry = {
      id: String(pickField(record, aliases.id) ?? `row-${index + 1}`),
      start: String(pickField(record, aliases.start) ?? ""),
      duration_minutes: parseMinutes(pickField(record, aliases.duration_minutes) ?? 0),
      client: String(pickField(record, aliases.client) ?? ""),
      project: String(pickField(record, aliases.project) ?? ""),
      task: String(pickField(record, aliases.task) ?? ""),
      tags: normalizeTags(pickField(record, aliases.tags) ?? [], separator),
      description: String(pickField(record, aliases.description) ?? "")
    };

    const missingFields = config.toggl.required_fields.filter((fieldName) => {
      const value = entry[fieldName];
      return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    });

    if (missingFields.length > 0) {
      const error = new Error(`Entry ${entry.id} is missing required fields: ${missingFields.join(", ")}`);
      error.record = record;
      throw error;
    }

    return entry;
  });
}

function roundMinutes(minutes, increment, policy) {
  if (policy === "ceil") {
    return Math.max(increment, Math.ceil(minutes / increment) * increment);
  }

  if (policy === "floor") {
    return Math.max(increment, Math.floor(minutes / increment) * increment);
  }

  return Math.max(increment, Math.round(minutes / increment) * increment);
}

function hashValue(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function toWorkDate(start) {
  return start.slice(0, 10);
}

function createParserContext(config, normalizedProjectName, parserName, redactedLogging) {
  return {
    normalizedProjectName,
    parserName,
    redactedLogging,
    meetingTaskNames: config.entry_classification.meeting_task_names ?? [],
    ticketIdRegexes: (config.entry_classification.ticket_id_patterns ?? []).map((pattern) => new RegExp(pattern)),
    meetingBucketTags: config.meeting_bucket_tags ?? {},
    activityDescriptionTags: config.activity_description_tags ?? {},
    incrementMinutes: config.rounding.increment_minutes ?? 30,
    roundingPolicy: config.rounding.policy ?? "nearest"
  };
}

function toGroupedKey(baseItem) {
  if (baseItem.entry_type === "ticket_work") {
    return [
      baseItem.entry_type,
      baseItem.work_date,
      baseItem.target_project_code,
      baseItem.task_id ?? "",
      baseItem.activity_code ?? "",
      baseItem.target_description
    ].join("|");
  }

  if (baseItem.entry_type === "meeting") {
    return [
      baseItem.entry_type,
      baseItem.work_date,
      baseItem.target_project_code,
      baseItem.meeting_bucket ?? "unbucketed"
    ].join("|");
  }

  return [baseItem.entry_type, baseItem.work_date, baseItem.source_ids[0]].join("|");
}

function buildBaseItem(entry, config, redactedLogging) {
  const normalizedProjectName = normalizeProjectName(entry.project, config.parser_factory.project_aliases ?? {});
  const parserName =
    config.parser_factory.project_parser_map?.[normalizedProjectName] ?? config.parser_factory.default_parser ?? "default";
  const parser = getParserByName(parserName);
  const context = createParserContext(config, normalizedProjectName, parserName, redactedLogging);
  const parsed = parser.parseEntry(entry, context);
  const projectCode = config.project_code_map?.[normalizedProjectName];
  const needsProjectReview = !projectCode;
  const reviewReasons = [...(parsed.reviewReasons ?? [])];

  if (needsProjectReview) {
    reviewReasons.push("Project is missing a target project code mapping.");
  }

  const redactedSourceSnapshot = {
    source_id_suffix: entry.id.slice(-6),
    source_hash: hashValue(entry.id),
    has_description: Boolean(entry.description),
    tag_count: entry.tags.length
  };

  return {
    source_ids: [entry.id],
    entry_type: parsed.entryType,
    work_date: toWorkDate(entry.start),
    task_id: parsed.taskId,
    duration_minutes_raw: entry.duration_minutes,
    duration_minutes_rounded: 0,
    target_project_code: projectCode ?? "UNMAPPED_PROJECT",
    activity_code: parsed.activityCode,
    target_description: parsed.targetDescription,
    meeting_bucket: parsed.meetingBucket,
    needs_review: Boolean(parsed.needsReview) || needsProjectReview,
    review_reasons: reviewReasons,
    idempotency_key: "",
    source_snapshot: redactedSourceSnapshot
  };
}

function aggregateBaseItems(baseItems, config) {
  const grouped = new Map();

  for (const item of baseItems) {
    const groupKey = toGroupedKey(item);
    const existing = grouped.get(groupKey);

    if (!existing) {
      grouped.set(groupKey, {
        ...item,
        source_ids: [...item.source_ids],
        review_reasons: [...item.review_reasons]
      });
      continue;
    }

    existing.duration_minutes_raw += item.duration_minutes_raw;
    existing.source_ids.push(...item.source_ids);
    existing.needs_review = existing.needs_review || item.needs_review;
    existing.review_reasons = Array.from(new Set([...existing.review_reasons, ...item.review_reasons]));
  }

  return Array.from(grouped.values()).map((item) => {
    const idBasis = [
      item.entry_type,
      item.work_date,
      item.target_project_code,
      item.task_id ?? "",
      item.activity_code ?? "",
      item.meeting_bucket ?? "",
      item.target_description
    ].join("|");

    return {
      ...item,
      source_ids: Array.from(new Set(item.source_ids)).sort(),
      duration_minutes_rounded: roundMinutes(
        item.duration_minutes_raw,
        config.rounding.increment_minutes ?? 30,
        config.rounding.policy ?? "nearest"
      ),
      idempotency_key: hashValue(idBasis)
    };
  });
}

function redactItem(item) {
  return {
    ...item,
    source_ids: item.source_ids.map((sourceId) => `...${String(sourceId).slice(-6)}`),
    source_snapshot: item.source_snapshot
  };
}

function buildExceptions(baseItems, aggregatedItems, redactedLogging) {
  const detailed = [];

  for (const item of [...baseItems, ...aggregatedItems]) {
    if (!item.needs_review) {
      continue;
    }

    detailed.push({
      idempotency_key: item.idempotency_key || null,
      entry_type: item.entry_type,
      work_date: item.work_date,
      target_project_code: item.target_project_code,
      task_id: redactedLogging && item.task_id ? `...${item.task_id.slice(-4)}` : item.task_id,
      review_reasons: item.review_reasons,
      source_ids: redactedLogging ? item.source_ids.map((sourceId) => `...${sourceId.slice(-6)}`) : item.source_ids
    });
  }

  return detailed;
}

function buildRunSummary(inputPath, parserCounts, aggregatedItems, exceptions, redactedLogging) {
  return {
    input_path: inputPath,
    redacted_logging: redactedLogging,
    parser_usage: parserCounts,
    total_output_items: aggregatedItems.length,
    total_exception_items: exceptions.length,
    total_rounded_minutes: aggregatedItems.reduce((sum, item) => sum + item.duration_minutes_rounded, 0)
  };
}

export function runMapper({
  rootDir,
  inputPath,
  outputDir,
  configPath = "./config/mapping.json",
  privateConfigPath = "./config/private.mapping.json",
  redact = true
}) {
  const config = loadConfig(rootDir, configPath, privateConfigPath);
  const rawEntries = readInputFile(path.resolve(rootDir, inputPath));
  const normalizedEntries = normalizeRecords(rawEntries, config);
  const parserCounts = {};

  const baseItems = normalizedEntries.map((entry) => {
    const normalizedProjectName = normalizeProjectName(entry.project, config.parser_factory.project_aliases ?? {});
    const parserName =
      config.parser_factory.project_parser_map?.[normalizedProjectName] ?? config.parser_factory.default_parser ?? "default";
    parserCounts[parserName] = (parserCounts[parserName] ?? 0) + 1;
    return buildBaseItem(entry, config, redact);
  });

  const aggregatedItems = aggregateBaseItems(baseItems, config);
  const detailedExceptions = buildExceptions(baseItems, aggregatedItems, redact);
  const redactedItems = aggregatedItems.map(redactItem);
  const summary = buildRunSummary(inputPath, parserCounts, aggregatedItems, detailedExceptions, redact);
  const resolvedOutputDir = path.resolve(rootDir, outputDir);

  ensureDirectory(resolvedOutputDir);
  writeJson(path.join(resolvedOutputDir, "report_items.json"), aggregatedItems);
  writeJson(path.join(resolvedOutputDir, "report_items.redacted.json"), redactedItems);
  writeJson(path.join(resolvedOutputDir, "exceptions.json"), detailedExceptions);
  writeJson(path.join(resolvedOutputDir, "run-summary.json"), summary);

  return summary;
}
