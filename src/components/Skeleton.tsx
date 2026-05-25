export function SkeletonBar({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-[var(--color-bg-secondary)] ${className}`}
      aria-hidden
    />
  );
}

export function SkeletonPage({ title = 'Loading…' }: { title?: string }) {
  return (
    <div className="min-h-screen">
      <div className="border-b-2 border-[var(--color-ct)] bg-[var(--color-bg-primary)]">
        <div className="max-w-[1080px] mx-auto px-6 py-3 flex items-center justify-between">
          <span className="font-display font-bold text-[20px]">DGLS</span>
          <span className="tracked text-[10px] text-[var(--color-text-secondary)]">
            {title}
          </span>
        </div>
      </div>
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <SkeletonBar className="h-9 w-64 mb-2" />
          <SkeletonBar className="h-3 w-48" />
        </div>
        <SkeletonBar className="h-px w-full mb-6" />
        {[80, 60, 70, 55, 65].map((w, i) => (
          <SkeletonBar key={i} className={`h-10 w-full mb-px`} />
        ))}
      </main>
    </div>
  );
}
