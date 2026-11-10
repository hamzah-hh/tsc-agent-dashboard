/** Round to at most 2 decimals (91.7 stays 91.7, 95.0399999 becomes 95.04). */
export function round2(n: number | null | undefined): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
