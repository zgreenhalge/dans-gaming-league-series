export function SkeletonBar({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-[var(--color-bg-secondary)] ${className}`}
      aria-hidden
    />
  );
}

/** A placeholder for a tab's content while its data is still loading — shared by every "fetch this
 *  tab's data lazily, on first open" spot (`CombinedSeasonTabView`'s top tabs, `SeasonTabView`'s own
 *  Stats/Advanced Stats sub-tabs) so the loading affordance can't drift between them. */
export function TabLoadingSkeleton() {
  return (
    <div aria-hidden>
      <SkeletonBar className="h-px w-full mb-6" />
      {[1, 2, 3, 4, 5].map((i) => (
        <SkeletonBar key={i} className="h-10 w-full mb-px" />
      ))}
    </div>
  );
}

/** A retry affordance for a tab whose lazy data fetch failed — see `TabLoadingSkeleton`'s own doc
 *  comment for why this is shared rather than redefined per caller. */
export function TabLoadError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="font-mono text-[12px] text-[var(--color-text-secondary)] flex items-center gap-3">
      <span>Couldn&apos;t load {label}.</span>
      <button onClick={onRetry} className="underline decoration-dotted hover:text-[var(--color-text-primary)]">
        Retry
      </button>
    </div>
  );
}
