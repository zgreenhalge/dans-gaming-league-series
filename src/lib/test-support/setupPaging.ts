// Global Vitest setup: simulates PostgREST's row cap at a size a small fixture reaches. Every
// `fetchAllPages()` read pages in `TEST_PAGE_SIZE`-row windows, and the fake client cuts every
// read with no `.eq()`/`.in()` filter off at the same size (`setFakeRowCap()`), so such a read that
// skips `fetchAllPages()` loses rows and its test fails instead of truncating in production.

import { __setPageSizeForTests } from '../queries/_paging';
import { setFakeRowCap } from './fakeSupabase';

const TEST_PAGE_SIZE = 2;

__setPageSizeForTests(TEST_PAGE_SIZE);
setFakeRowCap(TEST_PAGE_SIZE);
