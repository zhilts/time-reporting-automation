import type { ParsedEntry, ParserContext, ProjectParser, TogglEntry } from "../types.ts";

export const defaultParser: ProjectParser = {
  name: "default",
  parseEntry(entry: TogglEntry, context: ParserContext): ParsedEntry {
    const looksLikeTicket = context.ticketIdRegexes.some((regex) => regex.test(entry.task));
    const meetingTag = entry.tags.find((tag) => context.meetingBucketTags[tag]);

    if (context.meetingTaskNames.includes(entry.task) || meetingTag) {
      const bucket = meetingTag ? context.meetingBucketTags[meetingTag] : null;
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

    if (looksLikeTicket) {
      const activityTag = entry.tags.find((tag) => context.activityDescriptionTags[tag]);
      return {
        entryType: "ticket_work",
        taskId: entry.task,
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
      targetDescription: entry.tags[0] ?? "Other",
      meetingBucket: null,
      needsReview: true,
      reviewReasons: ["Entry did not match known ticket or meeting conventions."]
    };
  }
};
