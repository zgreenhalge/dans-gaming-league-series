// A month calendar's day grid, keyed by local calendar day (`YYYY-MM-DD`). Pure; "local" is whatever
// timezone the `Date` arguments are read in, so call it in the browser for the viewer's own days.

/** `date`'s calendar day in the runtime's timezone, `YYYY-MM-DD`. */
export function localDayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The weeks (Sunday first) of `month` (0-based) in `year`, each seven day keys, with `null` for the
 *  days before the 1st and after the last. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(localDayKey(new Date(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** The month (`{ year, month }`, 0-based) `offset` months from `from`. */
export function addMonths(from: { year: number; month: number }, offset: number): { year: number; month: number } {
  const d = new Date(from.year, from.month + offset, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}
