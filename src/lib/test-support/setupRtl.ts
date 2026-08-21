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

// jsdom doesn't implement `Element.scrollIntoView` (throws "not a function" if called), so any
// component using it — e.g. a deep-link scroll-to-section — needs a stub under jsdom's `.test.tsx`
// suites. Guarded behind `typeof Element` since this file also runs for plain-`node`-environment
// `.test.ts` files, which have no DOM globals at all.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom doesn't implement `ResizeObserver` either, so any component measuring its own container
// (e.g. a chart that lays out relative to its rendered width) needs a stub under jsdom's `.test.tsx`
// suites. Same `typeof` guard as above, for the same reason.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
