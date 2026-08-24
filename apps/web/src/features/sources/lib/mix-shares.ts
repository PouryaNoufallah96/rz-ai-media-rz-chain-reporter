export const MIX_PERCENT_FORMAT = {
  maximumFractionDigits: 0,
  style: "percent",
} as const;

export function mixPercents(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return counts.map(() => 0);

  const ranked = counts.map((count, index) => {
    const exact = (count * 100) / total;
    const floor = Math.floor(exact);
    return { floor, frac: exact - floor, index };
  });
  let remainder = 100 - ranked.reduce((sum, item) => sum + item.floor, 0);
  const order = ranked.toSorted((a, b) => b.frac - a.frac || a.index - b.index);
  const shares = ranked.map((item) => item.floor);

  for (const { index } of order) {
    if (remainder <= 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    remainder -= 1;
  }

  return shares;
}
