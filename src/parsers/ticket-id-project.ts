import type { ParsedEntry, ParserContext, ProjectParser, TogglEntry } from "../types.ts";
import { parseTaskIdPrefix } from "./task-id.ts";

function extractTicketId(entry: TogglEntry, context: ParserContext): string | null {
  const prefixedTaskId = parseTaskIdPrefix(entry.description).taskId;
  const candidates = [
    ...(prefixedTaskId ? [prefixedTaskId] : []),
    ...context.ticketIdSources.map((source) => entry[source] ?? "").map((value) => value.trim()).filter(Boolean)
  ];
  for (const candidate of candidates) {
    if (context.ticketIdRegexes.some((regex) => regex.test(candidate))) {
      return candidate;
    }
  }
  return null;
}

function isMeetingLike(entry: TogglEntry, context: ParserContext): boolean {
  if (context.meetingTaskNames.includes(entry.task)) {
    return true;
  }

  if (entry.tags.some((tag) => Boolean(context.meetingBucketTags[tag]))) {
    return true;
  }

  const description = entry.description.trim().toLowerCase();
  return context.meetingDescriptionPatterns.some((pattern) => description.includes(pattern.toLowerCase()));
}

function resolveMeetingDescription(entry: TogglEntry, context: ParserContext, bucket: string | null): string {
  const description = entry.description.trim();

  if (context.meetingDescriptionMode === "preserve") {
    return description || bucket || "Communication";
  }

  if (context.meetingDescriptionMode === "aggregate_all") {
    return "Communication";
  }

  return bucket ?? description ?? "Communication";
}

export const ticketIdProjectParser: ProjectParser = {
  name: "ticket-id-project",
  parseEntry(entry: TogglEntry, context: ParserContext): ParsedEntry {
    const { strippedDescription } = parseTaskIdPrefix(entry.description);
    const description = strippedDescription || entry.description.trim();

    if (isMeetingLike(entry, context)) {
      const bucketTag = entry.tags.find((tag) => context.meetingBucketTags[tag]);
      const bucket = bucketTag ? context.meetingBucketTags[bucketTag] : null;
      const targetDescription = resolveMeetingDescription(entry, context, bucket);
      const needsReview = context.meetingDescriptionMode === "bucket" ? !bucket : targetDescription.trim().length === 0;
      return {
        entryType: "meeting",
        taskId: null,
        activityCode: "Communication",
        targetDescription,
        meetingBucket: bucket,
        needsReview,
        reviewReasons: needsReview ? ["Meeting entry is missing a usable description or recognized communication grouping."] : []
      };
    }

    const ticketId = extractTicketId(entry, context);
    if (ticketId) {
      const activityTag = entry.tags.find((tag) => context.activityDescriptionTags[tag]);
      const activityCode = activityTag ? context.activityDescriptionTags[activityTag] : (entry.tags[0] ?? "Work");
      return {
        entryType: "ticket_work",
        taskId: ticketId,
        activityCode,
        targetDescription: description && description !== ticketId ? description : activityCode,
        meetingBucket: null,
        needsReview: !activityTag,
        reviewReasons: activityTag ? [] : ["Ticket entry is missing a recognized activity tag."]
      };
    }

    const fallbackActivity = context.activityDescriptionTags[entry.tags[0] ?? ""] ?? entry.tags[0] ?? entry.description ?? "Other";
    return {
      entryType: "other",
      taskId: null,
      activityCode: fallbackActivity,
      targetDescription: description || fallbackActivity,
      meetingBucket: null,
      needsReview: entry.tags.length === 0,
      reviewReasons: entry.tags.length === 0 ? ["Entry has no tag and did not match ticket or meeting conventions."] : []
    };
  }
};
