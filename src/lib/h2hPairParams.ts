// The URL encoding of an H2H pair: `a` / `b` are player names, `type` is `'opponent'` and is
// omitted for the default `'partner'`. `h2hPairHref()` (`crumbs.ts`) writes it for links;
// `parseH2HPairFromParams()` / `h2hPairToParams()` (`components/useH2HPairUrlState.ts`) read and
// write it for the page's own URL state. Both sides go through the helpers below, so the param
// names and the default live in one place.

export type H2HPairType = 'partner' | 'opponent';

/** The type a pair has when the URL carries no `type` param. */
export const DEFAULT_H2H_PAIR_TYPE: H2HPairType = 'partner';

/** The URL param names of a pair. */
export const H2H_PAIR_PARAM = { a: 'a', b: 'b', type: 'type' } as const;

/** The `a`/`b`/`type` params for a pair of names; `type` is absent for the default. */
export function h2hPairNameParams(aName: string, bName: string, type: H2HPairType): Record<string, string> {
  const params: Record<string, string> = { [H2H_PAIR_PARAM.a]: aName, [H2H_PAIR_PARAM.b]: bName };
  if (type !== DEFAULT_H2H_PAIR_TYPE) params[H2H_PAIR_PARAM.type] = type;
  return params;
}

/** The pair's names and type from URL params; `null` when either name is absent. An unrecognised
 *  `type` reads as the default. */
export function readH2HPairNames(
  searchParams: URLSearchParams,
): { aName: string; bName: string; type: H2HPairType } | null {
  const aName = searchParams.get(H2H_PAIR_PARAM.a);
  const bName = searchParams.get(H2H_PAIR_PARAM.b);
  if (!aName || !bName) return null;
  const type = searchParams.get(H2H_PAIR_PARAM.type) === 'opponent' ? 'opponent' : DEFAULT_H2H_PAIR_TYPE;
  return { aName, bName, type };
}
