import { TopbarShell } from '@/components/TopbarShell';
import { SkeletonBar as Skeleton } from '@/components/Skeleton';

export default function MapDetailLoading() {
  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Maps', href: '/maps' }, { label: '…' }]} />
      <div className="h-[200px] bg-[var(--color-bg-secondary)] border-b border-[var(--color-border-primary)]" />
      <main className="max-w-[1080px] mx-auto px-6 pb-16 mt-8">
        <div className="flex justify-end gap-4 mb-4">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-24" />
        </div>
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-64 w-full" />
      </main>
    </div>
  );
}
