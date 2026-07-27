## Summary

- What changed and why. Cite code by symbol name (`getGauntletStats()` in `src/lib/queries/gauntlet.ts`), never by line number.

## Test plan

<!-- Strike through (~~like this~~) any item that doesn't apply to this PR.
     Every remaining line MUST use GitHub checkbox syntax — "- [ ]" or "- [x]" — never a plain "- " bullet.
     CI's checklist gate only sees real checkboxes; a plain-bullet line silently skips verification instead
     of failing the check. Only mark "- [x]" for something you actually ran/verified for this PR. -->

- [ ] `npm run build` (or the relevant `npx tsx src/lib/**/*.test.ts`) passes
- [ ] Manual check on the deployed preview, for UI changes
- [ ] Updated the doc that owns this area (`docs/README.md`'s index) if behavior changed

## Related issues

<!-- `Closes #123` only if this PR fully resolves it; otherwise a bare `#123` and leave it open. -->
