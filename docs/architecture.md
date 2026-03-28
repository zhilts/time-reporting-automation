# Architecture

## Principles

- Deterministic logic for data transformation.
- No LLM in the mapping path.
- Browser automation only for the target-system UI step.
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

### Uploader

Responsibilities:

- Read `report_items.json`.
- Create items in the target system.
- Save progress state for resume.
- Capture screenshots and errors on failure.

Non-responsibilities:

- No data transformation.
- No mutation of item meaning.

## Why This Model

If the target system is stable and Toggl export is under your control, the transformation should be plain code plus config, not prompt behavior.

The plugin layer is there because plain code still needs a clean place for project-specific reporting conventions.

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
