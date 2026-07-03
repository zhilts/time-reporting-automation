# Architecture

## Principles

- Deterministic logic for data transformation.
- No LLM in the mapping path.
- Target-system writes go through an adapter boundary.
- Resume-safe output with explicit exceptions.

## Separation

### Mapper

Responsibilities:

- Read a fixed Toggl export format.
- Resolve the correct project parser from a registry.
- Normalize records.
- Classify records into `ticket_work`, `meeting`, or `other`.
- Resolve target project and activity codes from config.
- Aggregate meetings by rule.
- Apply rounding rules.
- Emit `report_items.json` and `exceptions.json`.

Non-responsibilities:

- No browser access.
- No guessing on unknown mappings.

### Project Parser

Responsibilities:

- Express project-specific interpretation rules.
- Decide how Toggl `task`, `tags`, and `description` map into target reporting semantics.
- Override defaults where a project reports time differently.

Examples:

- `Project Alpha` may interpret `Task=TICKET-123` as `TaskId`.
- Another project may use `Task=Meeting` plus a tag family for work categories.
- A future internal project may have no ticket IDs at all and derive activity from tags only.

Contract:

- input: normalized Toggl entry plus project config
- output: partial reporting meaning used by the shared mapper pipeline

### Upload Planner

Responsibilities:

- Read `report_items.json`.
- Allocate standard and overtime buckets.
- Create a target-system-neutral upload plan.
- Save progress state for resume.

Non-responsibilities:

- No target-system side effects.
- No browser or API access.
- No data transformation.
- No mutation of item meaning.

### Reporting Adapter

Responsibilities:

- Accept the prepared upload plan.
- Create or reuse records in the target reporting system.
- Reset records for a selected range when supported.
- Persist item statuses through the shared upload state file.

Backends:

- `playwright` drives a browser profile and target UI.
- `external-command` delegates to a local command over a JSON stdin/stdout protocol.

Non-responsibilities:

- No Toggl parsing.
- No project-specific semantic mapping.
- No hard dependency on any one MCP server or target-system API.

## Why This Model

If the target system is stable and Toggl export is under your control, the transformation should be plain code plus config, not prompt behavior.

The parser layer is there because plain code still needs a clean place for project-specific reporting conventions.

The adapter layer is separate because different target systems may expose browser-only flows, MCP tools, REST APIs, or CLI bridges.

## Sensitive Data Strategy

The shared repository contains:

- contracts
- generic parsers
- generic examples
- privacy-safe docs

The local runtime environment contains:

- private project aliases
- internal project codes
- ticket prefix patterns
- category and meeting bucket mappings
