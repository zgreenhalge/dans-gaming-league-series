import { describe, expect, it } from 'vitest';
import {
  bodySha,
  bodySignals,
  digestIssue,
  findTriageNote,
  findRefs,
  inRanges,
  matchesFilter,
  parseRanges,
  parseTitle,
  renderTable,
  type RawComment,
  type RawIssue,
} from '../../scripts/issue-digest-shared';

function issue(over: Partial<RawIssue> = {}): RawIssue {
  return {
    number: 10,
    title: 'perf(db): speed up a read',
    body: 'Body.',
    user: { login: 'Octo' },
    labels: [{ name: 'enhancement' }],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    html_url: 'https://github.com/o/r/issues/10',
    ...over,
  };
}

describe('parseRanges / inRanges', () => {
  it('selects single numbers, spans, and open ends', () => {
    const r = parseRanges('12, 405-417, 700-, -3');
    expect([1, 3, 4, 12, 13, 404, 405, 417, 418, 699, 700, 9999].filter((n) => inRanges(n, r))).toEqual([
      1, 3, 12, 405, 417, 700, 9999,
    ]);
  });

  it('rejects malformed or inverted terms', () => {
    for (const bad of ['', 'abc', '5-3', '-', '1,,2', '1-2-3']) expect(() => parseRanges(bad)).toThrow();
  });
});

describe('parseTitle', () => {
  it('reads type and scope, tolerating a missing scope or breaking mark', () => {
    expect(parseTitle('perf(db): x')).toEqual({ type: 'perf', scope: 'db' });
    expect(parseTitle('chore: x')).toEqual({ type: 'chore', scope: null });
    expect(parseTitle('feat(h2h)!: x')).toEqual({ type: 'feat', scope: 'h2h' });
    expect(parseTitle('Feature: Vanity urls')).toEqual({ type: null, scope: null });
  });
});

describe('findRefs', () => {
  it('collects #n and URL mentions, deduplicated, excluding the issue itself', () => {
    expect(findRefs('See #719, #707 and https://github.com/o/r/pull/719, also #10 and #3', 10)).toEqual([3, 707, 719]);
  });
});

describe('bodySignals', () => {
  it('detects each signal', () => {
    const s = bodySignals('## Done when\n- [ ] x\nDecide whether to do it. Open question: where? Unverified. Needs a live match. Replaces #1.');
    expect(s).toEqual({ hasDoneWhen: true, openQuestions: 3, unverified: true, externalBlocker: true, supersedes: true });
  });

  it('is quiet on a plain body', () => {
    expect(bodySignals('Rename the helper.')).toEqual({
      hasDoneWhen: false,
      openQuestions: 0,
      unverified: false,
      externalBlocker: false,
      supersedes: false,
    });
  });
});

describe('matchesFilter', () => {
  it('drops pull requests and applies every set filter', () => {
    expect(matchesFilter(issue({ pull_request: {} }), {})).toBe(false);
    expect(matchesFilter(issue(), { author: 'octo' })).toBe(true);
    expect(matchesFilter(issue(), { author: 'someone' })).toBe(false);
    expect(matchesFilter(issue(), { labels: ['Enhancement'] })).toBe(true);
    expect(matchesFilter(issue(), { labels: ['enhancement', 'bug'] })).toBe(false);
    expect(matchesFilter(issue(), { ranges: parseRanges('11-') })).toBe(false);
  });
});

describe('digestIssue / renderTable', () => {
  it('trims the body to maxBody and renders a row per issue', () => {
    const d = digestIssue(issue({ body: 'abcdef' }), 3);
    expect(d.body).toBe('abc');
    expect(d.bodyChars).toBe(6);
    expect(digestIssue(issue(), 0).body).toBe('');
    const table = renderTable([d]);
    expect(table.split('\n')).toHaveLength(3);
    expect(table).toContain('| 10 | perf(db): speed up a read | Octo | perf | 6 |');
  });
});

describe('findTriageNote', () => {
  const marker = (sha: string) => `<!-- triage-assessment body-sha=${sha} -->\n## Triage assessment`;
  const comment = (body: string | null, at: string): RawComment => ({ html_url: `https://x/${at}`, created_at: at, body });

  it('returns null when no comment opens with the marker, including a reply that quotes one', () => {
    const quoted = `> ${marker('abc')}\n\nAgreed.`;
    expect(findTriageNote([comment('looks good', 'a'), comment(quoted, 'b'), comment(null, 'c')], 'abc')).toBeNull();
  });

  it('uses the latest assessment and marks it fresh only when the body hash matches', () => {
    const sha = bodySha('Body.');
    const comments = [comment(marker('000000000000'), 'old'), comment('chatter', 'mid'), comment(marker(sha), 'new')];
    expect(findTriageNote(comments, sha)).toEqual({ url: 'https://x/new', postedAt: 'new', fresh: true });
    expect(findTriageNote(comments, bodySha('Edited body.'))).toMatchObject({ postedAt: 'new', fresh: false });
  });

  it('flows through digestIssue and renders a Triaged column only when comments were read', () => {
    const i = issue();
    const withNote = digestIssue(i, 0, [comment(marker(bodySha('Body.')), 't')]);
    expect(withNote.triage?.fresh).toBe(true);
    expect(digestIssue(i, 0).triage).toBeUndefined();
    expect(digestIssue(i, 0, []).triage).toBeNull();
    expect(renderTable([withNote])).toContain('| Triaged |');
    expect(renderTable([withNote])).toContain('| fresh |');
    expect(renderTable([digestIssue(i, 0)])).not.toContain('Triaged');
  });
});
