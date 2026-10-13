// The inline red error line shown beside or under an action that failed. Renders nothing when there
// is no error, so call sites pass `error` straight through instead of guarding it. Spacing and
// wrapping modifiers (`mt-2`, `break-words`) go in `className`. An array renders one line per
// message; an empty array renders nothing.
//
// Two tones: `default` is the site's `font-mono` red; `onDark` is the lighter red (and the
// surrounding font) used on the dark match panels, where `--color-accent-red-fg` is too dim.

const SIZE_CLS = {
  10: 'text-[10px]',
  11: 'text-[11px]',
  12: 'text-[12px]',
} as const;

const TONE_CLS = {
  default: 'font-mono text-[var(--color-accent-red-fg)]',
  onDark: 'text-red-300',
} as const;

export default function ErrorText({
  error,
  as: Tag = 'div',
  size = 11,
  tone = 'default',
  className = '',
}: {
  error: string | string[] | null | undefined;
  as?: 'div' | 'span' | 'p';
  size?: keyof typeof SIZE_CLS;
  tone?: keyof typeof TONE_CLS;
  className?: string;
}) {
  const lines = Array.isArray(error) ? error : error ? [error] : [];
  if (lines.length === 0) return null;
  const cls = [TONE_CLS[tone], SIZE_CLS[size], Array.isArray(error) ? 'flex flex-col gap-0.5' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag className={cls}>
      {Array.isArray(error) ? lines.map((line, i) => <div key={i}>{line}</div>) : error}
    </Tag>
  );
}
