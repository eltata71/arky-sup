import React from 'react';

const clampSkeletonCount = (value: number | undefined, fallback: number, max: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(max, Math.floor(value)));
};

/**
 * Shimmer-style skeleton block.  Layered: a base muted color with a moving
 * gradient on top, giving a more polished feel than `animate-pulse`.
 * Falls back gracefully when prefers-reduced-motion is set (the gradient pauses
 * via the global rule in index.html).
 */
const Pulse: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`relative overflow-hidden bg-gray-200/80 dark:bg-gray-800/70 rounded ${className}`}>
        <div className="absolute inset-0 skeleton-shimmer" aria-hidden />
    </div>
);

export const ProjectCardSkeleton: React.FC = () => (
    <div className="p-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex items-start justify-between mb-3">
            <Pulse className="w-10 h-10 rounded-lg" />
            <Pulse className="w-20 h-6 rounded-md" />
        </div>
        <Pulse className="w-3/4 h-5 mb-2" />
        <Pulse className="w-full h-4 mb-1" />
        <Pulse className="w-2/3 h-4" />
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
            <Pulse className="w-28 h-3" />
            <Pulse className="w-4 h-4 rounded-full" />
        </div>
    </div>
);

export const ProjectGridSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => {
    const safeCount = clampSkeletonCount(count, 4, 24);

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Array.from({ length: safeCount }).map((_, i) => (
                <ProjectCardSkeleton key={i} />
            ))}
        </div>
    );
};

export const StatCardSkeleton: React.FC = () => (
    <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
        <Pulse className="w-24 h-4 mb-4" />
        <div className="space-y-3">
            <div className="flex justify-between items-center">
                <Pulse className="w-28 h-4" />
                <Pulse className="w-8 h-5" />
            </div>
            <div className="flex justify-between items-center">
                <Pulse className="w-20 h-4" />
                <Pulse className="w-8 h-5" />
            </div>
        </div>
    </div>
);

export const DashboardSkeleton: React.FC = () => (
    <div className="flex flex-col lg:flex-row gap-8">
        <div className="w-full lg:w-1/4 space-y-4">
            <StatCardSkeleton />
            <Pulse className="w-full h-28 rounded-xl" />
            <StatCardSkeleton />
        </div>
        <div className="w-full lg:w-3/4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
                <div className="flex justify-between items-center mb-6">
                    <Pulse className="w-40 h-5" />
                    <Pulse className="w-28 h-4" />
                </div>
                <ProjectGridSkeleton />
            </div>
        </div>
    </div>
);

export const TableRowSkeleton: React.FC = () => (
    <tr>
        <td className="px-6 py-4"><Pulse className="w-32 h-4" /></td>
        <td className="px-6 py-4"><Pulse className="w-40 h-4" /></td>
        <td className="px-6 py-4"><Pulse className="w-16 h-5 rounded-full" /></td>
        <td className="px-6 py-4 text-right"><Pulse className="w-16 h-4 ml-auto" /></td>
    </tr>
);

/** Skeleton for streaming AI chat replies — alternates two-line bubbles. */
export const ChatBubbleSkeleton: React.FC = () => (
    <div className="flex justify-start">
        <div className="max-w-[80%] p-4 rounded-2xl rounded-bl-none bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm space-y-2">
            <Pulse className="w-48 h-3" />
            <Pulse className="w-64 h-3" />
            <Pulse className="w-40 h-3" />
        </div>
    </div>
);

/** Skeleton for diagram canvas — block with mock nodes. */
export const DiagramSkeleton: React.FC = () => (
    <div className="relative w-full h-full p-12 flex items-center justify-center">
        <div className="grid grid-cols-3 gap-8 w-full max-w-2xl">
            <Pulse className="h-24 rounded-xl col-start-2" />
            <Pulse className="h-24 rounded-xl" />
            <Pulse className="h-24 rounded-xl" />
            <Pulse className="h-24 rounded-xl" />
            <Pulse className="h-20 rounded-xl col-start-2" />
        </div>
    </div>
);

/** Skeleton for a single line — useful inside hero copy / inline replies. */
export const LineSkeleton: React.FC<{ className?: string }> = ({ className = 'w-40 h-3' }) => (
    <Pulse className={className} />
);
