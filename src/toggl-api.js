import path from "node:path";
import { ensureDirectory, writeJson } from "./io.js";

const TOGGL_BASE_URL = "https://api.track.toggl.com/api/v9";

function buildBasicAuthHeader(apiToken) {
  const credentials = Buffer.from(`${apiToken}:api_token`).toString("base64");
  return `Basic ${credentials}`;
}

function buildTimeEntriesUrl({ startDate, endDate, before, since, meta = true }) {
  const url = new URL(`${TOGGL_BASE_URL}/me/time_entries`);
  if (startDate) {
    url.searchParams.set("start_date", startDate);
  }
  if (endDate) {
    url.searchParams.set("end_date", endDate);
  }
  if (before) {
    url.searchParams.set("before", before);
  }
  if (since) {
    url.searchParams.set("since", String(since));
  }
  if (meta) {
    url.searchParams.set("meta", "true");
  }
  return url;
}

function toMinutesFromDuration(entry) {
  const durationSeconds = Number(entry.duration ?? 0);
  if (!Number.isFinite(durationSeconds)) {
    return 0;
  }

  if (durationSeconds < 0) {
    return 0;
  }

  return Math.max(1, Math.round(durationSeconds / 60));
}

function normalizeTimeEntry(entry) {
  return {
    id: String(entry.id),
    start: entry.start,
    duration_minutes: toMinutesFromDuration(entry),
    client: entry.client_name ?? "",
    project: entry.project_name ?? "",
    task: entry.task_name ?? "",
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    description: entry.description ?? ""
  };
}

function summarizeFetchedEntries(entries) {
  const projectCount = new Set(entries.map((entry) => entry.project_name).filter(Boolean)).size;
  return {
    fetched_entries: entries.length,
    distinct_projects: projectCount
  };
}

export async function fetchTogglTimeEntries({
  apiToken,
  startDate,
  endDate,
  before,
  since
}) {
  if (!apiToken) {
    throw new Error("Missing Toggl API token. Set it in config/private.mapping.json or TOGGL_API_TOKEN.");
  }

  const url = buildTimeEntriesUrl({ startDate, endDate, before, since, meta: true });
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: buildBasicAuthHeader(apiToken)
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Toggl API request failed: ${response.status} ${response.statusText} ${body.slice(0, 400)}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Unexpected Toggl API response: expected an array of time entries.");
  }

  return payload;
}

export async function fetchAndStoreTogglEntries({
  rootDir,
  apiToken,
  startDate,
  endDate,
  before,
  since,
  outputPath
}) {
  const rawEntries = await fetchTogglTimeEntries({ apiToken, startDate, endDate, before, since });
  const normalizedEntries = rawEntries.map(normalizeTimeEntry);
  const resolvedOutputPath = path.resolve(rootDir, outputPath);

  ensureDirectory(path.dirname(resolvedOutputPath));
  writeJson(resolvedOutputPath, normalizedEntries);

  return {
    output_path: resolvedOutputPath,
    start_date: startDate ?? null,
    end_date: endDate ?? null,
    before: before ?? null,
    since: since ?? null,
    ...summarizeFetchedEntries(rawEntries)
  };
}
