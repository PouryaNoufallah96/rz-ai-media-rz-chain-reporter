const MILLISECONDS_PER_HOUR = 3_600_000;

export function scoreFreshness(
  publishedAt: Date | null,
  runStartedAt: Date,
  ladder: readonly { maxAgeHours: number; score: number }[],
  futureNeutralScore: number,
): number | null {
  if (publishedAt === null) {
    return null;
  }

  const ageMs = runStartedAt.getTime() - publishedAt.getTime();
  if (ageMs < 0) {
    return Math.round(futureNeutralScore);
  }

  for (const rung of ladder) {
    if (ageMs < rung.maxAgeHours * MILLISECONDS_PER_HOUR) {
      return Math.round(rung.score);
    }
  }

  const terminal = ladder.at(-1);
  if (terminal === undefined) {
    throw new Error("FRESHNESS_LADDER_EMPTY");
  }

  return Math.round(terminal.score);
}
