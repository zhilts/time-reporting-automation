# Time Reporting Automation

Deterministic pipeline for transforming Toggl Track entries into target-system-ready items and uploading the current week in one run.

## What It Does

- Fetches entries from Toggl Track.
- Maps them through project-specific rules from local config.
- Aggregates matching entries into date-range report rows.
- Rounds at the aggregated item level.
- Validates entries offline before upload.
- Uploads the current calendar week into the target UI.

## Setup

1. Copy `config/private.mapping.example.json` to `config/private.mapping.json`.
2. Fill in local project aliases, internal codes, browser profile settings, and Toggl API token.
3. Make sure the configured Chrome profile can already open the target time-reporting page.

## Entry Format

Use a strict description prefix when you need to send a task ID into the target system:

```text
[#TASK_ID] Human-readable description
```

Examples:

- `[#HD-2088] Vulnerability fix`
- `[#REF4032L] Technical Interview - Candidate Name`

Recommended Toggl conventions:

- Ticket work:
  - `Project`: project name
  - `Tags`: activity tag such as `Development`, `Code review`, `Communication`
  - `Description`: `[#TASK_ID] Human-readable description` or just `TASK_ID` when no extra text is needed
- Interviews:
  - `Project`: passthrough project
  - `Tags`: `Interview`
  - `Description`: `[#TASK_ID] Interview description`

Running timers are not syncable. Stop the timer before running the weekly upload.

## Commands

Check how entries will parse without writing anything into the target UI:

```bash
npm run check:entries -- --date 2026-06-25
```

If `--date` is omitted, the command uses the current date in `Europe/Warsaw`.

Clean current-week artifacts and delete current-week records from the target UI:

```bash
npm run reset:week-current
```

Run the full current-week flow:

```bash
npm run sync:week-current
```

Run the flow for an explicit range:

```bash
npm run sync -- --start-date 2026-03-23 --end-date 2026-03-29
```

Reset an explicit range:

```bash
npm run reset -- --start-date 2026-03-23 --end-date 2026-03-29
```

## Runtime Files

The tool writes transient artifacts under `runtime/` while syncing:

- `runtime/input/` for fetched Toggl data
- `runtime/output/week-current/` for mapped report items and summaries
- `runtime/state/` for upload state

`npm run reset:week-current` removes current-week artifacts again.

## Design Notes

- Mapping is deterministic.
- Sensitive names and codes stay in `config/private.mapping.json`.
- Project-specific behavior lives behind the parser factory.
- Task IDs come from the description prefix, not from permanent Toggl tags.
- Unmappable entries are left for manual correction instead of guessed.

## Privacy Boundary

This repository should stay generic.

- No real client names in source code.
- No real internal project codes in committed config.
- No real ticket prefixes in parser names or examples.
- No production exports committed to the repository.
