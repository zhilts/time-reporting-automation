# Time Reporting Automation

Deterministic pipeline for transforming Toggl Track entries into target-system-ready items and uploading the current week in one run.

## What It Does

- Fetches entries from Toggl Track.
- Maps them through project-specific rules from local config.
- Aggregates matching entries into date-range report rows.
- Rounds at the aggregated item level.
- Uploads the current calendar week into the target UI.

## Setup

1. Copy `config/private.mapping.example.json` to `config/private.mapping.json`.
2. Fill in local project aliases, internal codes, browser profile settings, and Toggl API token.
3. Make sure the configured Chrome profile can already open the target time-reporting page.

## Daily Use

Clean current-week artifacts and delete current-week records from the target UI:

```bash
npm run reset:week-current
```

Run the full current-week flow:

```bash
npm run sync:week-current
```

Optional explicit range override:

```bash
npm run sync:week-current -- --start-date 2026-03-23 --end-date 2026-03-29
```

## Runtime Files

The tool writes transient artifacts under `runtime/`:

- `runtime/input/` for fetched Toggl data
- `runtime/output/week-current/` for mapped report items and summaries
- `runtime/state/` for upload state

`npm run reset:week-current` removes the weekly artifacts again.

## Design Notes

- Mapping is deterministic.
- Sensitive names and codes stay in `config/private.mapping.json`.
- Project-specific behavior lives behind the parser factory.
- Unmappable entries are left for manual correction instead of guessed.

## Privacy Boundary

This repository should stay generic.

- No real client names in source code.
- No real internal project codes in committed config.
- No real ticket prefixes in parser names or examples.
- No production exports committed to the repository.
