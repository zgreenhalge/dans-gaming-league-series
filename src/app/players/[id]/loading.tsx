import { TopbarShell } from '@/components/TopbarShell';
import { SkeletonBar as Skeleton } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Players', href: '/players' }, { label: '…' }]} />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <Skeleton className="h-9 w-48 mb-2" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-px w-full mb-6" />
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-10 w-full mb-px" />
        ))}
      </main>
    </div>
  );
}
