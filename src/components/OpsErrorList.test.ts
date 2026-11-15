/**
 * Regression harness for `OPERATION_LABELS` (src/components/OpsErrorList.tsx) — every background job
 * type's claim-failure operation resolves to a derived label, so a new job type never shows a raw
 * `<type>_claim` key in the ops-error list.
 *
 * Run:  npx vitest run src/components/OpsErrorList.test.ts
 */

import { describe, expect, it } from 'vitest';
import { BACKGROUND_JOB_TYPES, jobClaimOperation } from '@/lib/jobs';
import { OPERATION_LABELS } from './OpsErrorList';

describe('OPERATION_LABELS', () => {
  it('labels every background job type\'s claim operation', () => {
    for (const type of BACKGROUND_JOB_TYPES) {
      expect(OPERATION_LABELS[jobClaimOperation(type)], type).toBeTruthy();
    }
  });

  it('title-cases the job type', () => {
    expect(OPERATION_LABELS.demo_ingest_claim).toBe('Demo Ingest Claim');
  });
});
