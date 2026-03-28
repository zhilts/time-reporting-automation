# Toggl Conventions

## Goal

Use Toggl as the source of truth without forcing fragile parsing from free-text descriptions.

These conventions are defaults, not hard global rules. The parser factory can select a different interpretation model per project.

## Ticket Work

Recommended shape:

- `Client`: external client label, for example `Client A`
- `Project`: external project label, for example `Project Alpha`
- `Task`: external ticket ID, for example `TICKET-123`
- `Tags`: work category, for example `CategoryA`, `CategoryB`, `CategoryC`
- `Description`: optional human detail

Interpretation:

- `Task` becomes target `TaskId`
- `Project` is mapped to an internal project code
- first recognized category tag becomes target `Description`

## Meetings

Recommended shape:

- `Client`: external client label, for example `Client A`
- `Project`: external project label, for example `Project Alpha`
- `Task`: `Meeting`
- `Tags`: one or more categories such as `MeetingTypeA`, `MeetingTypeB`, `MeetingTypeC`
- `Description`: calendar title or short note

Interpretation:

- meetings are not treated as ticket work
- meetings are grouped into reporting buckets before target-system upload
- rounding is applied after grouping

## Avoid

- Putting task IDs inside `Description`
- Using `Task` as both issue ID and work category
- Rounding each short call independently
- Encoding all project-specific behavior in one monolithic mapper
- Committing real client names or internal codes to the repository
