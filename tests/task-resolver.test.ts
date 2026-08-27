import { describe, expect, it } from "vitest";
import { resolveTaskLabel } from "../src/task-resolver.ts";
import type { AppConfig } from "../src/types.ts";

const config = {
  toggl: {
    required_fields: [],
    field_aliases: {}
  },
  parser_factory: {
    default_parser: "default"
  },
  entry_classification: {},
  rounding: {
    increment_minutes: 30,
    policy: "nearest"
  },
  upload: {
    task_matchers_by_project: {
      PROJECT: [
        {
          match_type: "prefix",
          pattern: "Review:",
          task_label: "Performance Review"
        }
      ]
    }
  }
} satisfies AppConfig;

describe("resolveTaskLabel", () => {
  it("uses a description matcher before the raw activity code", () => {
    expect(resolveTaskLabel("PROJECT", "Other", "Review: employee", config)).toBe("Performance Review");
  });

  it("canonicalizes raw activity code casing from known task labels", () => {
    expect(resolveTaskLabel("PROJECT", "Performance review", "Assessment", config)).toBe("Performance Review");
  });
});
