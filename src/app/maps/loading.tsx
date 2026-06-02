import { TopbarShell } from '@/components/TopbarShell';
import { SkeletonBar as Skeleton } from '@/components/Skeleton';

export default function MapsLoading() {
  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Maps' }]} />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <Skeleton className="h-10 w-28" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/3] w-full" />
          ))}
        </div>
      </main>
    </div>
  );
}
