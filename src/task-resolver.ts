import type { AppConfig } from "./types.ts";

type TaskMatcher = {
  match_type: "exact" | "prefix" | "includes" | "regex";
  pattern: string;
  task_label: string;
};

function matchDescription(description: string, matcher: TaskMatcher): boolean {
  if (matcher.match_type === "exact") {
    return description === matcher.pattern;
  }

  if (matcher.match_type === "prefix") {
    return description.startsWith(matcher.pattern);
  }

  if (matcher.match_type === "includes") {
    return description.includes(matcher.pattern);
  }

  return new RegExp(matcher.pattern).test(description);
}

function findCaseInsensitiveLabel(labels: Iterable<string>, target: string): string | null {
  const normalizedTarget = target.toLocaleLowerCase();
  for (const label of labels) {
    if (label.toLocaleLowerCase() === normalizedTarget) {
      return label;
    }
  }

  return null;
}

export function resolveTaskLabel(
  targetProjectCode: string | null,
  activityCode: string | null,
  targetDescription: string,
  config: AppConfig
): string | null {
  if (!targetProjectCode) {
    return null;
  }

  const uploadConfig = config.upload ?? {};
  const activityMappings = uploadConfig.task_by_activity_code?.[targetProjectCode] ?? {};
  if (activityCode) {
    const exactMapping = activityMappings[activityCode];
    if (exactMapping) {
      return exactMapping;
    }

    const matchingMappingKey = findCaseInsensitiveLabel(Object.keys(activityMappings), activityCode);
    if (matchingMappingKey) {
      return activityMappings[matchingMappingKey];
    }
  }

  const matchers = uploadConfig.task_matchers_by_project?.[targetProjectCode] ?? [];
  for (const matcher of matchers) {
    if (matchDescription(targetDescription, matcher)) {
      return matcher.task_label;
    }
  }

  if (activityCode) {
    const knownLabels = [
      ...Object.values(activityMappings),
      ...matchers.map((matcher) => matcher.task_label),
      uploadConfig.default_task_by_project?.[targetProjectCode]
    ].filter((label): label is string => Boolean(label));
    return findCaseInsensitiveLabel(knownLabels, activityCode) ?? activityCode;
  }

  return uploadConfig.default_task_by_project?.[targetProjectCode] ?? null;
}
