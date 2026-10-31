const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export async function runAll() {
  let passed = 0;
  let failed = 0;

  for (const entry of tests) {
    try {
      await entry.fn();
      passed += 1;
      console.log(`  ok  ${entry.name}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL ${entry.name}`);
      console.error(String(error?.stack ?? error).replace(/^/gm, '       '));
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);
  if (failed > 0) process.exitCode = 1;
}
