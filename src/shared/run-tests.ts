import { testCases } from './incentive.testcases';

/**
 * Command-line runner for the calculation test cases (npm test).
 * The same cases also run in the browser from the Super Admin Test Center.
 */
let failed = 0;
for (const tc of testCases) {
  const outcome = tc.run();
  const status = outcome.passed ? 'PASS' : 'FAIL';
  console.log(`${status}  #${tc.id}  ${tc.description}`);
  if (!outcome.passed) {
    failed++;
    console.log(`        expected: ${outcome.expected}`);
    console.log(`        actual:   ${outcome.actual}`);
  }
}
console.log(`\n${testCases.length - failed} of ${testCases.length} calculation tests passed`);
process.exit(failed > 0 ? 1 : 0);
