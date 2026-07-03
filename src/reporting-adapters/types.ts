import type { AppConfig, UploadPlan, UploadState, WeekRange } from "../types.ts";

export type ReportingBackend = "playwright" | "external-command";

export type ReportingSyncRequest = {
  rootDir: string;
  config: AppConfig;
  weekRange: WeekRange;
  plan: UploadPlan;
  planPath: string;
  state: UploadState;
  statePath: string;
};

export type ReportingResetRequest = {
  rootDir: string;
  config: AppConfig;
  weekRange: WeekRange;
};

export type ReportingSyncResult = {
  backend: ReportingBackend;
  uploadedKeys: string[];
  reusedExistingKeys: string[];
  deletedRecordIds: string[];
};

export type ReportingResetResult = {
  backend: ReportingBackend;
  deletedRecordIds: string[];
};

export type ReportingAdapter = {
  backend: ReportingBackend;
  sync(request: ReportingSyncRequest): Promise<ReportingSyncResult>;
  reset(request: ReportingResetRequest): Promise<ReportingResetResult>;
};
