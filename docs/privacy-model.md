# Privacy Model

## Goal

Build the mapper so that sensitive project metadata and time-entry contents do not need to be exposed in prompts, committed files, or shared examples.

## Rules

- Keep committed code generic.
- Keep committed configs generic.
- Store sensitive mappings in a local private config file.
- Process raw Toggl exports locally.
- Never commit exports, screenshots, or generated target payloads.

## Local-Only Files

Suggested local files:

- `config/private.mapping.json`
- `runtime/input/`
- `runtime/output/`
- `runtime/state/`

These should be ignored by version control.

## Mapper Design

The mapper should support a local-only execution path:

1. read Toggl export from disk
2. load generic config
3. overlay private config
4. resolve project parser
5. emit sanitized logs by default

The direct API path should follow the same rule:

1. fetch from Toggl API using a local token
2. store normalized raw input only in `runtime/input/`
3. map locally into `runtime/output/`

## Logging Strategy

Default logs should not print:

- raw descriptions
- real project names
- internal project codes
- full task IDs

Instead log:

- counts
- parser name
- anonymized hashes
- exception categories

## Exception Strategy

Exceptions should have two modes:

- safe summary for terminal output
- full local detail written to ignored files only

## Future Hardening

- support `--redact` mode for all CLI output
- support hashing source IDs before logging
- support explicit allowlist fields for debug output
