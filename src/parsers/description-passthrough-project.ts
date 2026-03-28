import type { ParsedEntry, ParserContext, ProjectParser, TogglEntry } from "../types.ts";

export const descriptionPassthroughProjectParser: ProjectParser = {
  name: "description-passthrough-project",
  parseEntry(entry: TogglEntry, _context: ParserContext): ParsedEntry {
    const description = entry.description.trim();

    return {
      entryType: "other",
      taskId: null,
      activityCode: null,
      targetDescription: description || "Unlabeled",
      meetingBucket: null,
      needsReview: description.length === 0,
      reviewReasons: description.length === 0 ? ["Entry description is empty."] : []
    };
  }
};
