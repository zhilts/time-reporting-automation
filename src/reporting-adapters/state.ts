import type { UploadState } from "../types.ts";

export function markUploadStateStatus(
  state: UploadState,
  idempotencyKey: string,
  status: "pending" | "uploaded" | "failed" | "skipped" | "blocked",
  lastError: string | null = null
): UploadState {
  const now = new Date().toISOString();
  const targetItem = state.items.find((item) => item.idempotency_key === idempotencyKey);
  if (!targetItem) {
    return state;
  }

  targetItem.status = status;
  targetItem.last_error = lastError;
  targetItem.updated_at = now;
  state.updated_at = now;
  return state;
}

export function markUploadedState(state: UploadState, uploadedKeys: string[]): UploadState {
  const uploadedSet = new Set(uploadedKeys);
  const now = new Date().toISOString();

  for (const item of state.items) {
    if (!uploadedSet.has(item.idempotency_key)) {
      continue;
    }

    item.status = "uploaded";
    item.last_error = null;
    item.updated_at = now;
  }

  state.updated_at = now;
  return state;
}
