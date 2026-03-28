# Time Reporting Automation

Deterministic pipeline for transforming Toggl Track exports into target-system-ready items, with a separate browser uploader for the final UI step.

## Approach

- Keep mapping deterministic.
- Keep UI automation isolated.
- Aggregate short meetings before rounding.
- Preserve manual review and final submit in the target system.
- Allow project-specific parser plugins behind a shared contract.

## Proposed Flow

1. Export entries from Toggl Track in a fixed schema.
2. Resolve a project parser from the parser factory.
3. Run the parser to normalize and validate records.
4. Aggregate meeting entries into target reporting buckets.
5. Apply 30-minute rounding at the aggregated item level.
6. Produce `report_items.json` and `exceptions.json`.
7. Run the target-system uploader to enter items into the UI.
8. Manually review and submit in the target system.

## Project Layout

- `docs/` - operating assumptions and rules
- `schemas/` - canonical data contracts
- `config/` - public and private JSON configuration
- `fixtures/` - generic sample input
- `src/` - runnable mapper CLI, parser factory, and uploader stub

## Usage

1. Copy `config/private.mapping.example.json` to `config/private.mapping.json`.
2. Fill in local project aliases, internal codes, and tag mappings.
3. Add your Toggl API token to the private config or `TOGGL_API_TOKEN`.
4. Either fetch from Toggl directly or use an existing export.

Direct sync from Toggl API:

```bash
npm run sync:toggl -- --start-date 2026-03-01 --end-date 2026-03-31 --redact
```

Fetch only:

```bash
npm run fetch:toggl -- --start-date 2026-03-01 --end-date 2026-03-31
```

Map an existing local export:

```bash
npm run map -- --input /absolute/path/to/export.json --redact
```

Outputs are written to `runtime/output/latest/`.

For a generic dry run:

```bash
npm run map:sample
```

## Current View

One useful source-system pattern looks like this:

- Ticket work:
  - `Client: Client A`
  - `Project: Project Alpha`
  - `Task: TICKET-123`
  - `Tags: category tag`
- Meetings:
  - better modeled as `Task: Meeting`
  - meeting type goes to tags
  - title stays in `Description`

That keeps ticket IDs stable and lets meetings be aggregated intentionally instead of manually collapsed out of convenience.

## Parser Factory

The mapper should not hardcode all project rules in one place.

- Shared pipeline code handles validation, grouping, rounding, and output.
- A parser factory picks a project-specific parser by Toggl project name.
- Each parser can tweak classification, tag interpretation, and target-field mapping for one project.

This gives you one core engine and multiple small project adapters instead of one giant mapper that becomes unmaintainable over time.

## Privacy Boundary

This repository should stay generic.

- No real client names in source code.
- No real internal project codes in committed config.
- No real ticket prefixes in parser names or examples.
- No production exports committed to the repository.

Sensitive mappings should live in a local file such as `config/private.mapping.json`, which is loaded at runtime and excluded from version control.
