import React from 'react';
import { slideBrandFor } from '../../../services/presentation/slideBrand';
import type {
  PresentationCalloutContent,
  PresentationContentBlock,
  PresentationDiagramContent,
  PresentationKpiContent,
  PresentationSlide,
  PresentationTableContent,
} from '../../../services/presentation';
import { useCountUp } from '../../../hooks/useCountUp';
import { useUiText } from '../../../hooks/useUiText';
import { cn } from '../../ui/cn';
import { SlideMermaid } from './SlideMermaid';

/**
 * One slide, drawn with the brand the PPTX uses (12.4): a light master with a
 * primary bar for content layouts, a dark master with a bottom band for hero
 * layouts, two columns where the layout says so, 4:3. The classes below are the
 * Tailwind names of `SLIDE_PALETTE`; the layout's look comes from
 * `slideBrandFor`, never from a table of its own.
 *
 * `stage` is the presenting size; `thumb` is the presenter's next-slide
 * preview, which shows the shape of the slide rather than all of it.
 */
export type SlideFrameSize = 'thumb' | 'normal' | 'stage';

export interface SlideFrameProps {
  slide: PresentationSlide;
  size?: SlideFrameSize;
  /** KPIs count up to their value — only while presenting. */
  animateFigures?: boolean;
  reducedMotion?: boolean;
  children?: React.ReactNode;
}

const calloutTone: Record<PresentationCalloutContent['tone'], string> = {
  info: 'border-primary-600 bg-primary-50',
  success: 'border-success-700 bg-success-50',
  warning: 'border-warning-700 bg-warning-50',
  risk: 'border-danger-700 bg-danger-50',
};

const trendTone: Record<NonNullable<PresentationKpiContent['trend']>, { glyph: string; className: string }> = {
  up: { glyph: '▲', className: 'text-success-700' },
  down: { glyph: '▼', className: 'text-danger-700' },
  flat: { glyph: '■', className: 'text-gray-600' },
};

const KpiTile: React.FC<{ kpi: PresentationKpiContent; animate: boolean; reducedMotion: boolean }> = ({ kpi, animate, reducedMotion }) => {
  const t = useUiText();
  const shown = useCountUp(kpi.value, animate, reducedMotion);
  const trend = kpi.trend ? trendTone[kpi.trend] : null;
  return (
    <div className="rounded-lg border border-gray-300 bg-white p-4">
      <div className="text-xs uppercase tracking-wider text-gray-600">{kpi.label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        {/* The count is decoration; the figure a screen reader hears is the final one. */}
        <span aria-hidden="true" className="text-3xl font-semibold tabular-nums text-gray-900">{shown}</span>
        <span className="sr-only">{kpi.value}</span>
        {trend && kpi.trend && (
          <span className={cn('text-sm', trend.className)}>
            <span aria-hidden="true">{trend.glyph}</span>
            <span className="sr-only">{t(`deck.trend.${kpi.trend}`)}</span>
          </span>
        )}
      </div>
      {kpi.detail && <div className="mt-1 text-xs text-gray-600">{kpi.detail}</div>}
    </div>
  );
};

const SlideBlock: React.FC<{ block: PresentationContentBlock; animate: boolean; reducedMotion: boolean }> = ({ block, animate, reducedMotion }) => {
  const t = useUiText();
  switch (block.type) {
    case 'text':
      return <p className="leading-relaxed">{typeof block.content === 'string' ? block.content : ''}</p>;
    case 'bullets': {
      const items = Array.isArray(block.content) ? (block.content as string[]) : [];
      return (
        <ul className="space-y-2">
          {items.map((item, idx) => (
            <li key={idx} className="flex gap-3 break-inside-avoid">
              <span aria-hidden className="mt-2 inline-block h-2 w-2 flex-shrink-0 rounded-full bg-primary-600" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    }
    case 'callout': {
      const callout = block.content as PresentationCalloutContent;
      return (
        <div className={cn('rounded-lg border-l-4 px-4 py-3 text-gray-900', calloutTone[callout.tone] ?? calloutTone.info)}>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-600">{t(`deck.tone.${callout.tone}`)}</div>
          {callout.title && <div className="font-semibold">{callout.title}</div>}
          <div>{callout.body}</div>
        </div>
      );
    }
    case 'kpi': {
      const items = Array.isArray(block.content) ? (block.content as PresentationKpiContent[]) : [block.content as PresentationKpiContent];
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {items.map((kpi, idx) => <KpiTile key={idx} kpi={kpi} animate={animate} reducedMotion={reducedMotion} />)}
        </div>
      );
    }
    case 'table': {
      const table = block.content as PresentationTableContent;
      return (
        <div className="overflow-x-auto rounded-lg border border-gray-300 bg-white">
          <table className="min-w-full divide-y divide-gray-300 text-sm">
            {table.caption && <caption className="caption-bottom px-3 py-2 text-left text-xs text-gray-600">{table.caption}</caption>}
            <thead className="bg-gray-100">
              <tr>{table.headers.map((header, idx) => <th key={idx} scope="col" className="px-3 py-2 text-left font-semibold">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {table.rows.map((row, rIdx) => (
                <tr key={rIdx}>{row.map((cell, cIdx) => <td key={cIdx} className="px-3 py-2">{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'diagram': {
      const diagram = block.content as PresentationDiagramContent;
      if (diagram.mermaid?.trim()) return <SlideMermaid code={diagram.mermaid} description={diagram.description} />;
      return (
        <div className="rounded-lg border border-dashed border-primary-300 bg-primary-50 px-4 py-3 text-sm">
          <div className="mb-1 text-xs uppercase tracking-wider text-primary-700">{t('deck.diagram')}</div>
          {diagram.description && <div>{diagram.description}</div>}
        </div>
      );
    }
    case 'imagePlaceholder':
      return (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-100 px-4 py-6 text-center text-sm text-gray-600">
          <div className="mb-1 text-xs uppercase tracking-wider">{t('deck.image')}</div>
          <div>{typeof block.content === 'string' ? block.content : ''}</div>
        </div>
      );
    default:
      return null;
  }
};

const isProse = (block: PresentationContentBlock): boolean => block.type === 'text' || block.type === 'bullets';

export const SlideFrame: React.FC<SlideFrameProps> = ({ slide, size = 'normal', animateFigures = false, reducedMotion = false, children }) => {
  const t = useUiText();
  const brand = slideBrandFor(slide.layout);
  const blocks = size === 'thumb' ? slide.contentBlocks.slice(0, 2) : slide.contentBlocks;
  const prose = blocks.filter(isProse);
  const rest = blocks.filter((block) => !isProse(block));
  const proseKeys = prose.map((block) => slide.contentBlocks.indexOf(block));
  const restKeys = rest.map((block) => slide.contentBlocks.indexOf(block));
  const sub = slide.subtitle || slide.keyMessage;
  const empty = slide.contentBlocks.length === 0 && !brand.hero;

  return (
    <article
      data-layout={slide.layout}
      data-hero={brand.hero ? 'true' : 'false'}
      data-decoration={brand.decoration}
      data-columns={brand.columns}
      aria-label={t('deck.slideLabel', { number: String(slide.slideNumber), title: slide.title })}
      className={cn(
        'relative mx-auto aspect-[4/3] w-full overflow-hidden rounded-xl font-sans shadow-xl',
        brand.hero ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900',
        size === 'normal' && 'max-w-4xl',
      )}
    >
      {brand.decoration === 'bar' && <span aria-hidden className="absolute inset-y-0 left-0 w-[1.3%] bg-primary-600" />}
      {brand.decoration === 'band' && <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3.2%] bg-primary-600" />}
      <div
        className={cn(
          'absolute inset-0 overflow-y-auto',
          size === 'thumb' ? 'px-[6%] py-[5%] text-[0.55rem]' : size === 'stage' ? 'px-[6%] py-[5%] text-lg md:text-xl' : 'px-[6%] py-[5%] text-sm md:text-base',
          brand.hero && 'flex flex-col justify-center',
          brand.align === 'center' && 'text-center',
        )}
      >
        <h2 className={cn('font-bold tracking-tight', brand.hero ? 'text-[2.4em]' : 'text-[1.75em]')}>{slide.title}</h2>
        {sub && <p className={cn('mt-2', brand.hero ? 'text-gray-300' : 'text-gray-600')}>{sub}</p>}
        {slide.keyMessage && slide.subtitle && !brand.hero && (
          <p className="mt-3 border-l-4 border-primary-600 pl-3 font-medium">
            <span className="sr-only">{t('deck.keyMessage')} </span>{slide.keyMessage}
          </p>
        )}
        {(prose.length > 0 || rest.length > 0) && (
          <div className="mt-[4%] space-y-4">
            {prose.length > 0 && (
              <div className={cn('space-y-3', brand.columns === 2 && prose.length > 1 && 'gap-8 sm:columns-2')}>
                {prose.map((block, idx) => (
                  <SlideBlock key={`${slide.id}-p-${proseKeys[idx]}`} block={block} animate={animateFigures} reducedMotion={reducedMotion} />
                ))}
              </div>
            )}
            {rest.map((block, idx) => (
              <SlideBlock key={`${slide.id}-b-${restKeys[idx]}`} block={block} animate={animateFigures} reducedMotion={reducedMotion} />
            ))}
          </div>
        )}
        {empty && size !== 'thumb' && <p className="mt-4 text-sm italic text-gray-600">{t('deck.emptySlide')}</p>}
      </div>
      {children}
    </article>
  );
};

export default SlideFrame;
