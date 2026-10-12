// The inline red error line shown beside or under an action that failed. Renders nothing when there
// is no error, so call sites pass `error` straight through instead of guarding it. Spacing and
// wrapping modifiers (`mt-2`, `break-words`) go in `className`.

const SIZE_CLS = {
  10: 'text-[10px]',
  11: 'text-[11px]',
  12: 'text-[12px]',
} as const;

export default function ErrorText({
  error,
  as: Tag = 'div',
  size = 11,
  className = '',
}: {
  error: string | null | undefined;
  as?: 'div' | 'span';
  size?: keyof typeof SIZE_CLS;
  className?: string;
}) {
  if (!error) return null;
  return <Tag className={`font-mono ${SIZE_CLS[size]} text-[var(--color-accent-red-fg)] ${className}`.trimEnd()}>{error}</Tag>;
}
