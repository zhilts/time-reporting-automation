export type UploadRunState = {
  last_completed_idempotency_key: string | null;
  processed_count: number;
};

// TODO:
// - read report_items.json
// - drive the target system via Playwright
// - verify row creation after save
// - persist run state after each successful item
// - capture screenshots and structured errors on failure
// - default to redacted logs and local-only artifacts
