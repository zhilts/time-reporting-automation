import type { ParsedEntry, ParserContext, ProjectParser, TogglEntry } from "../types.ts";

function extractTicketId(entry: TogglEntry, context: ParserContext): string | null {
  const candidates = context.ticketIdSources.map((source) => entry[source] ?? "").map((value) => value.trim()).filter(Boolean);
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

export const ticketIdProjectParser: ProjectParser = {
  name: "ticket-id-project",
  parseEntry(entry: TogglEntry, context: ParserContext): ParsedEntry {
    if (isMeetingLike(entry, context)) {
      const bucketTag = entry.tags.find((tag) => context.meetingBucketTags[tag]);
      const bucket = bucketTag ? context.meetingBucketTags[bucketTag] : null;
      return {
        entryType: "meeting",
        taskId: null,
        activityCode: null,
        targetDescription: bucket ?? "Meeting",
        meetingBucket: bucket,
        needsReview: !bucket,
        reviewReasons: bucket ? [] : ["Meeting entry is missing a recognized meeting bucket tag."]
      };
    }

    const ticketId = extractTicketId(entry, context);
    if (ticketId) {
      const activityTag = entry.tags.find((tag) => context.activityDescriptionTags[tag]);
      return {
        entryType: "ticket_work",
        taskId: ticketId,
        activityCode: null,
        targetDescription: activityTag ? context.activityDescriptionTags[activityTag] : (entry.tags[0] ?? "Work"),
        meetingBucket: null,
        needsReview: !activityTag,
        reviewReasons: activityTag ? [] : ["Ticket entry is missing a recognized activity tag."]
      };
    }

    return {
      entryType: "other",
      taskId: null,
      activityCode: null,
      targetDescription: context.activityDescriptionTags[entry.tags[0] ?? ""] ?? entry.tags[0] ?? entry.description ?? "Other",
      meetingBucket: null,
      needsReview: entry.tags.length === 0,
      reviewReasons: entry.tags.length === 0 ? ["Entry has no tag and did not match ticket or meeting conventions."] : []
    };
  }
};
