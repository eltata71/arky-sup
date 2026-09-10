/**
 * Chart primitives.
 *
 * Deliberately hand-rolled inline SVG rather than a charting dependency: the
 * dashboard needs five simple forms, and a 100 kB library for them would cost
 * more than it returns. Colour rules live with the caller's tokens; these
 * components only draw what they are handed.
 */
export { DonutChart } from './DonutChart';
export type { DonutChartProps } from './DonutChart';
export { StackedBar } from './StackedBar';
export type { StackedBarProps } from './StackedBar';
export { TrendArea } from './TrendArea';
export type { TrendAreaProps } from './TrendArea';
export { StatTile } from './StatTile';
export type { StatTileProps, StatTileTone } from './StatTile';
export { ChartEmptyState } from './ChartEmptyState';
export type { ChartEmptyStateProps } from './ChartEmptyState';
export { RadialGauge } from './RadialGauge';
export type { RadialGaugeProps } from './RadialGauge';
export { Sparkline } from './Sparkline';
export type { SparklineProps } from './Sparkline';
export { StatusBars } from './StatusBars';
export type { StatusBarsProps, StatusBarRow } from './StatusBars';
export { FlowBars } from './FlowBars';
export type { FlowBarsProps, FlowStage } from './FlowBars';
export { sumSegments } from './chartTypes';
export type { ChartSegment, ChartPoint } from './chartTypes';
