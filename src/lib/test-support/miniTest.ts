/**
 * Shared runner for src/lib/**\/*.test.ts scripts. Each file runs standalone via `npx tsx`
 * (see `npm test`'s discovery), not through a test framework — `test()` records a pass/fail per
 * call (awaiting the result only when `fn` returns a promise) and `report()` prints the summary,
 * exiting the process with code 1 if anything failed.
 */

let passed = 0;
const failures: string[] = [];

export function test(name: string, fn: () => void | Promise<void>): void | Promise<void> {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(
        () => {
          passed++;
        },
        (err) => {
          failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
        },
      );
    }
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
  }
}

export function report(): void {
  if (failures.length) {
    console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
    for (const f of failures) console.error(`  ✗ ${f}\n`);
    process.exit(1);
  }
  console.log(`✓ ${passed} passing`);
}
