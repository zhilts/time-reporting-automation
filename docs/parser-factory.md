# Parser Factory

## Why It Exists

Different client projects can report time differently even when the final target is still the same reporting system.

Examples:

- one project uses `Task` as an issue ID
- another uses `Task` as a work category
- another needs meetings collapsed by bucket
- another may require special activity descriptions

A single mapper with all rules in one file will become brittle. The factory keeps the shared pipeline stable and moves project-specific meaning into small parsers.

## Design

### Shared Core

The shared mapper pipeline should own:

- input validation
- parser selection
- aggregation
- rounding
- JSON schema validation
- exceptions output

### Project Parser

Each parser should own:

- record classification adjustments
- `TaskId` extraction rules
- activity/description mapping rules
- meeting bucket interpretation
- project-specific review rules

## Selection Strategy

Primary key:

- Toggl `project`

Fallbacks:

- explicit CLI flag
- config alias map
- default parser

## Suggested Interface

```ts
interface ProjectParser {
  name: string;
  parseEntry(entry: TogglEntry, context: ParseContext): ParsedEntry;
}
```

Selection should happen in the factory layer from config:

```ts
const parserName = config.parser_factory.project_parser_map[normalizedProjectName]
```

That keeps real project labels and aliases out of parser source files.

## Initial Registry

- `defaultParser`
- `ticketIdProjectParser`

## Example

For a ticket-driven client project:

- `Task=TICKET-123` -> `task_id=TICKET-123`
- `Tags=CategoryA` -> `target_description=CategoryA`
- `Task=Meeting` + `Tags=MeetingTypeA|MeetingTypeB` -> meeting bucket resolution
