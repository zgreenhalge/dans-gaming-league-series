export function SkeletonBar({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-[var(--color-bg-secondary)] ${className}`}
      aria-hidden
    />
  );
}
