# Aggregation Rules

## Ticket Work

Group by:

- `work_date`
- `target_project_code`
- `task_id`
- `activity_code`

Rule:

- Sum exact minutes first.
- Round only after grouping.

## Meetings

Group by:

- `work_date`
- `target_project_code`
- `meeting_bucket`

Suggested meeting buckets:

- `Meeting Bucket A`
- `Meeting Bucket B`
- `Meeting Bucket C`
- `Meeting Bucket D`
- `Meeting Bucket E`

Rule:

- Multiple short meetings can land in the same bucket on the same day.
- Total bucket duration is rounded to the nearest allowed 30-minute increment according to the configured policy.

## Rationale

This avoids systematic inflation caused by rounding every 10- or 15-minute call separately.

Actual bucket names should come from local config, not committed source.
