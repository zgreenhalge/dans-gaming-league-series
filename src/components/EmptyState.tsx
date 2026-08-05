// Shared "nothing here yet" message. `sm` is the inline one-liner used inside an
// already-bordered panel or list (stat tables, tab bodies, roster/schedule
// lists); `lg` is the standalone bordered, centered variant used when the
// empty state is the entire contents of a search/management surface.

export default function EmptyState({
  message,
  size = 'sm',
  className = '',
}: {
  message: React.ReactNode;
  /** `sm` — inline text, no border. `lg` — bordered, centered box. */
  size?: 'sm' | 'lg';
  /** Extra classes (e.g. spacing) merged onto the container. */
  className?: string;
}) {
  if (size === 'lg') {
    return (
      <div
        className={`font-mono text-[13px] text-[var(--color-text-secondary)] border border-[var(--color-border-tertiary)] rounded px-4 py-8 text-center ${className}`}
      >
        {message}
      </div>
    );
  }

  return (
    <div className={`font-mono text-[12px] text-[var(--color-text-secondary)] ${className}`}>
      {message}
    </div>
  );
}
