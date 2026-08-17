// Global Vitest setup: registers `@testing-library/react`'s `cleanup()` after every test (so a
// prior `.test.tsx` file's mounted DOM never leaks into the next test) and the `jest-dom` matchers
// (`toHaveAttribute()`, `toBeDisabled()`, etc). Runs for every test file, `.test.ts` included —
// `cleanup()` and the matcher registration are both no-ops when nothing was ever rendered, so plain
// `node`-environment suites are unaffected.

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});
