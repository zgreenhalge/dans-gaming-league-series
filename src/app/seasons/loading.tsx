import { TopbarShell } from '@/components/TopbarShell';
import { SkeletonBar as Skeleton } from '@/components/Skeleton';

export default function SeasonsLoading() {
  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Seasons' }]} />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="flex flex-col gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </main>
    </div>
  );
}
