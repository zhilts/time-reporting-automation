import type { ParsedEntry, ParserContext, ProjectParser, TogglEntry } from "../types.ts";
import { parseTaskIdPrefix } from "./task-id.ts";

function hasInterviewTag(tags: string[]): boolean {
  return tags.some((tag) => tag.toLowerCase() === "interview");
}

function resolveSingleTagActivityCode(tags: string[]): string | null {
  const normalizedTags = tags.map((tag) => tag.trim()).filter(Boolean);
  return normalizedTags.length === 1 ? normalizedTags[0] : null;
}

export const descriptionPassthroughProjectParser: ProjectParser = {
  name: "description-passthrough-project",
  parseEntry(entry: TogglEntry, _context: ParserContext): ParsedEntry {
    const { taskId, strippedDescription } = parseTaskIdPrefix(entry.description);
    const description = strippedDescription || entry.description.trim();
    const interview = hasInterviewTag(entry.tags);
    const activityCode = resolveSingleTagActivityCode(entry.tags);

    if (interview) {
      return {
        entryType: "other",
        taskId,
        activityCode: "Interview",
        targetDescription: description || "Interview",
        meetingBucket: null,
        needsReview: description.length === 0,
        reviewReasons: [
          ...(description.length === 0 ? ["Interview entry description is empty."] : [])
        ]
      };
    }

    return {
      entryType: "other",
      taskId,
      activityCode,
      targetDescription: description || "Unlabeled",
      meetingBucket: null,
      needsReview: description.length === 0,
      reviewReasons: description.length === 0 ? ["Entry description is empty."] : []
    };
  }
};
