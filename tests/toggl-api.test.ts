import { describe, expect, it } from "vitest";
import { buildTimeEntriesUrl } from "../src/toggl-api.ts";

describe("buildTimeEntriesUrl", () => {
  it("treats date-only endDate as inclusive", () => {
    const url = buildTimeEntriesUrl({
      apiToken: "token",
      startDate: "2026-07-27",
      endDate: "2026-07-29"
    });

    expect(url.searchParams.get("start_date")).toBe("2026-07-27");
    expect(url.searchParams.get("end_date")).toBe("2026-07-30");
  });

  it("keeps timestamp endDate unchanged", () => {
    const endDate = "2026-07-29T23:59:59+02:00";
    const url = buildTimeEntriesUrl({
      apiToken: "token",
      startDate: "2026-07-27T00:00:00+02:00",
      endDate
    });

    expect(url.searchParams.get("end_date")).toBe(endDate);
  });
});
