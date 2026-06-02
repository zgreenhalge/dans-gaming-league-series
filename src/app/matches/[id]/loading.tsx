import { TopbarShell } from '@/components/TopbarShell';
import { SkeletonBar as Skeleton } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: '…' }]} />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <Skeleton className="h-9 w-48 mb-2" />
        </div>
        <Skeleton className="h-px w-full mb-6" />
        <Skeleton className="h-48 w-full mb-4" />
        <Skeleton className="h-48 w-full" />
      </main>
    </div>
  );
}
