import { diffLines } from "diff";

export interface LineDiffChunk {
  kind: "added" | "removed" | "context";
  lines: string[];
}

export function formatLineDiff(before: string, after: string): LineDiffChunk[] {
  if (before === after) return [];
  return diffLines(before, after).flatMap((change) => {
    const lines = change.value.split("\n");
    if (change.value.endsWith("\n")) lines.pop();
    if (lines.length === 0) return [];
    return [
      {
        kind: change.added ? "added" : change.removed ? "removed" : "context",
        lines,
      },
    ];
  });
}
