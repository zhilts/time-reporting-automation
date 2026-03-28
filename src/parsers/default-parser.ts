import type { ParseContext, ParsedMeaning, TogglEntry } from "../types";
import type { ProjectParser } from "./project-parser";

export const defaultParser: ProjectParser = {
  name: "default",
  parseEntry(entry: TogglEntry, _context: ParseContext): ParsedMeaning {
    const looksLikeTicket = /^[A-Z]+-\d+$/.test(entry.task);
    const meetingTag = entry.tags.find((tag) =>
      ["MeetingTypeA", "MeetingTypeB", "MeetingTypeC"].includes(tag),
    );

    if (entry.task === "Meeting" || meetingTag) {
      return {
        entry_type: "meeting",
        task_id: null,
        activity_code: null,
        target_description: "Meeting",
        meeting_bucket: meetingTag ?? null,
      };
    }

    if (looksLikeTicket) {
      return {
        entry_type: "ticket_work",
        task_id: entry.task,
        activity_code: null,
        target_description: entry.tags[0] ?? "Work",
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
      review_reasons: ["Entry did not match default ticket or meeting conventions."],
    };
  },
};
