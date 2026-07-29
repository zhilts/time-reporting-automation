import { describe, expect, it } from "vitest";
import { descriptionPassthroughProjectParser } from "../src/parsers/description-passthrough-project.ts";
import type { ParserContext, TogglEntry } from "../src/types.ts";

const context: ParserContext = {
  normalizedProjectName: "Passthrough",
  parserName: "description-passthrough-project",
  redactedLogging: false,
  meetingTaskNames: [],
  meetingDescriptionPatterns: [],
  meetingDescriptionMode: "bucket",
  ticketIdRegexes: [],
  ticketIdSources: ["description"],
  meetingBucketTags: {},
  activityDescriptionTags: {},
  incrementMinutes: 30,
  roundingPolicy: "nearest"
};

function entry(overrides: Partial<TogglEntry> = {}): TogglEntry {
  return {
    id: "entry-1",
    start: "2026-07-29T10:00:00+02:00",
    duration_minutes: 30,
    client: "Client",
    project: "Passthrough",
    task: "",
    tags: [],
    description: "Learning session",
    ...overrides
  };
}

describe("descriptionPassthroughProjectParser", () => {
  it("uses a single tag as the activity code", () => {
    const parsed = descriptionPassthroughProjectParser.parseEntry(entry({
      tags: ["Internal Courses"]
    }), context);

    expect(parsed.activityCode).toBe("Internal Courses");
    expect(parsed.targetDescription).toBe("Learning session");
    expect(parsed.needsReview).toBe(false);
  });

  it("keeps the interview tag special case", () => {
    const parsed = descriptionPassthroughProjectParser.parseEntry(entry({
      tags: ["Interview"],
      description: "[#VAC-123] Candidate interview"
    }), context);

    expect(parsed.activityCode).toBe("Interview");
    expect(parsed.taskId).toBe("VAC-123");
    expect(parsed.targetDescription).toBe("Candidate interview");
  });
});
