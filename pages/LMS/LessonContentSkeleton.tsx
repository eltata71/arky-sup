import { Skeleton, SkeletonGroup } from '../../components/ui/Skeleton';

/** The title, prose and content block that arrive in a generated lesson. */
export function LessonContentSkeleton({ label }: { label: string }) {
  return <SkeletonGroup label={label} className="h-64 space-y-4 overflow-hidden py-4">
    <Skeleton className="h-7 w-2/3" />
    <Skeleton shape="text" lines={4} />
    <Skeleton className="h-24 w-full rounded-xl" />
  </SkeletonGroup>;
}
