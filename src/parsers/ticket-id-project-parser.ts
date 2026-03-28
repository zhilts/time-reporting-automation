import type { ParseContext, ParsedMeaning, TogglEntry } from "../types";
import type { ProjectParser } from "./project-parser";

const genericMeetingBucketByTag: Record<string, string> = {
  MeetingTypeA: "Meeting Bucket A",
  MeetingTypeB: "Meeting Bucket B",
  MeetingTypeC: "Meeting Bucket C",
};

export const ticketIdProjectParser: ProjectParser = {
  name: "ticket-id-project",
  parseEntry(entry: TogglEntry, _context: ParseContext): ParsedMeaning {
    if (entry.task === "Meeting") {
      const bucketTag = entry.tags.find((tag) => genericMeetingBucketByTag[tag]);
      return {
        entry_type: "meeting",
        task_id: null,
        activity_code: null,
        target_description: bucketTag ? genericMeetingBucketByTag[bucketTag] : "Meeting",
        meeting_bucket: bucketTag ? genericMeetingBucketByTag[bucketTag] : null,
        needs_review: !bucketTag,
        review_reasons: bucketTag ? [] : ["Meeting entry is missing a recognized meeting bucket tag."],
      };
    }

    if (/^[A-Z]+-\d+$/.test(entry.task)) {
      return {
        entry_type: "ticket_work",
        task_id: entry.task,
        activity_code: null,
        target_description: entry.tags[0] ?? "CategoryA",
        meeting_bucket: null,
      };
    }

    return {
      entry_type: "other",
      task_id: null,
      activity_code: null,
      target_description: entry.tags[0] ?? "Other",
      meeting_bucket: null,
      needs_review: true,
      review_reasons: ["Project entry did not match ticket or meeting conventions."],
    };
  },
};
