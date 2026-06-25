export type ParsedTaskIdPrefix = {
  taskId: string | null;
  strippedDescription: string;
};

const TASK_ID_PREFIX_REGEX = /^\[#([^\]]+)\]\s*(.*)$/;

export function parseTaskIdPrefix(description: string): ParsedTaskIdPrefix {
  const trimmedDescription = description.trim();
  const match = trimmedDescription.match(TASK_ID_PREFIX_REGEX);
  if (!match) {
    return {
      taskId: null,
      strippedDescription: trimmedDescription
    };
  }

  const taskId = match[1]?.trim() || null;
  const strippedDescription = (match[2] ?? "").trim();

  return {
    taskId,
    strippedDescription
  };
}
