/**
 * Barrel for the design-system components.  Lets callers do:
 *   import { Button, Card, Badge } from '@/components/ui';
 */
export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';
export { Card, CardHeader, CardTitle, CardDescription, CardFooter, CardEyebrow } from './Card';
export type { CardProps, CardTone } from './Card';
export { Input } from './Input';
export type { InputProps } from './Input';
export { Badge } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';
export { Kbd, ModKey, isMac } from './Kbd';
export { Spinner } from './Spinner';
export { Tooltip } from './Tooltip';
export { SafeRichText } from './SafeRichText';
export type { SafeRichTextProps } from './SafeRichText';
export { SegmentedControl } from './SegmentedControl';
export type { SegmentedOption } from './SegmentedControl';
export { Dropdown } from './Dropdown';
export type { DropdownProps, DropdownItem, DropdownSection } from './Dropdown';
export { EmptyState } from './EmptyState';
export { CommandPaletteTrigger } from './CommandPaletteTrigger';
export { AIArchitectAvatar, AIArchitectChip } from './AIArchitectIdentity';
export type { AIState } from './AIArchitectIdentity';
export { Tabs, TabList, Tab, TabPanel } from './Tabs';
export type { TabsProps, TabListProps, TabProps, TabPanelProps, TabsVariant, TabsSize } from './Tabs';
export { Drawer } from './Drawer';
export type { DrawerProps, DrawerSide, DrawerSize } from './Drawer';
export { Alert } from './Alert';
export type { AlertProps, AlertTone, AlertVariant } from './Alert';
export { Skeleton, SkeletonGroup } from './Skeleton';
export type { SkeletonProps, SkeletonGroupProps, SkeletonShape } from './Skeleton';
export { PageSkeleton } from './PageSkeleton';
export type { PageSkeletonProps } from './PageSkeleton';
export { ResizeHandle } from './ResizeHandle';
export type { ResizeHandleProps } from './ResizeHandle';
export { SectionHeader } from './SectionHeader';
export type { SectionHeaderProps } from './SectionHeader';
export { StatusDot, STATUS_VISUALS } from './StatusDot';
export type { StatusDotProps, StatusTone } from './StatusDot';
export { cn } from './cn';
export {
    DonutChart,
    StackedBar,
    TrendArea,
    StatTile,
    FlowBars,
    RadialGauge,
    Sparkline,
    StatusBars,
    sumSegments,
} from './charts';
export type {
    DonutChartProps,
    StackedBarProps,
    TrendAreaProps,
    StatTileProps,
    StatTileTone,
    FlowBarsProps,
    FlowStage,
    RadialGaugeProps,
    SparklineProps,
    StatusBarsProps,
    StatusBarRow,
    ChartSegment,
    ChartPoint,
} from './charts';
