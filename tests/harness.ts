/** A tiny check() helper shared by the server tests. Run them with: npm run test:server */
export const results: Array<{ name: string; ok: boolean }> = [];

export function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n        ${detail}` : ''}`);
}

export function section(title: string): void {
  console.log(`\n== ${title}`);
}

export function summary(): number {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} server checks passed`);
  return failed.length;
}
