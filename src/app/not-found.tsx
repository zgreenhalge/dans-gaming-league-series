import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen">
      <div className="border-b-2 border-[var(--color-ct)] bg-[var(--color-bg-primary)]">
        <div className="max-w-[1080px] mx-auto px-6 py-3">
          <Link href="/" className="font-display font-bold text-[20px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
            DGLS
          </Link>
        </div>
      </div>
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[36px] font-semibold leading-tight">
            Page not found
          </div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5">
            This page doesn&apos;t exist or may have moved.
          </div>
        </div>
        <Link
          href="/"
          className="tracked text-[11px] font-semibold px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
        >
          Back to home
        </Link>
      </main>
    </div>
  );
}
