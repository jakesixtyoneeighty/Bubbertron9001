export interface CompletedTaskStatus {
  summary?: string;
  verification?: string;
}

export function completedTaskMessage({
  summary,
  verification,
}: CompletedTaskStatus) {
  const result = summary?.trim() || "The task finished successfully.";
  const verified = verification?.trim();

  return [
    "**Task completed**",
    result,
    verified ? `**Verified:** ${verified}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

export function failedTaskMessage(error: string) {
  const detail = error.trim() || "The task stopped before it could finish.";
  return `**Task failed**\n\n${detail}`;
}
