import type { AppConfig } from "../types.ts";
import { externalCommandReportingAdapter } from "./external-command.ts";
import { playwrightReportingAdapter } from "./playwright.ts";
import type { ReportingAdapter, ReportingBackend } from "./types.ts";

export function resolveReportingBackend(config: AppConfig): ReportingBackend {
  const backend = config.reporting?.backend ?? "playwright";
  return backend === "mcp" ? "external-command" : backend;
}

export function createReportingAdapter(config: AppConfig): ReportingAdapter {
  const backend = resolveReportingBackend(config);

  if (backend === "playwright") {
    return playwrightReportingAdapter;
  }

  if (backend === "external-command") {
    return externalCommandReportingAdapter;
  }

  throw new Error(`Unsupported reporting backend: ${backend}`);
}
