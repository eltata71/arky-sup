/**
 * La cabecera del centro de mando: una cifra de salud, la cadena de los cuatro
 * niveles y el desglose de lo que baja esa cifra.
 *
 * Responde de una vez las tres primeras preguntas que el tablero debe contestar
 * —dónde estoy, qué está pasando, qué requiere atención— y lo hace en ese
 * orden de lectura: el arco a la izquierda, la cadena en el centro, el desglose
 * a la derecha.
 *
 * ## La cifra viene con su composición, siempre
 *
 * Un indicador de salud sin desglose es una opinión con forma de medición, y
 * éste además cruza tres niveles: sin ver que el 78 % sale de «dos entregables
 * bloqueados y un proyecto sin iniciativa», el lector no puede ni actuar ni
 * discrepar. Por eso el desglose no es un tooltip ni una pantalla aparte: está
 * al lado del número, siempre visible, y cada línea lleva a donde se arregla.
 *
 * La regla que lo gobierna vive en `buildPortfolioCommandCenter`, no aquí. Esta
 * pantalla no decide qué es estar deteriorado; lo pinta.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight, Boxes, Landmark, Layers, PackageCheck, ShieldCheck, type LucideIcon } from 'lucide-react';
import { RadialGauge, SectionHeader, StatusDot, cn, type StatusTone } from '../ui';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { TRANSITION, TYPE } from '../../lib/designTokens';
import { EA_LEVELS } from '../../lib/eaTerminology';
import {
  PORTFOLIO_BAND_LABELS,
  type PortfolioCommandCenter,
  type PortfolioHealthBand,
} from '../../services/architectureOffice/portfolio';

/**
 * La franja, vestida.
 *
 * Los cuatro cortes ya están decididos en el dominio; aquí sólo se les pone
 * color, y el color nunca va solo: `PORTFOLIO_BAND_LABELS` da el nombre escrito
 * y el `StatusDot` añade una forma distinta por franja. Un arco verde y un arco
 * ámbar son indistinguibles en escala de grises, y este número es justamente el
 * que alguien va a proyectar en una sala de comité.
 */
const BAND_VISUALS: Readonly<Record<PortfolioHealthBand, { stroke: string; ink: string; dot: StatusTone }>> = Object.freeze({
  strong: { stroke: 'stroke-[#059669] dark:stroke-[#34d399]', ink: 'text-[#047857] dark:text-[#34d399]', dot: 'success' },
  steady: { stroke: 'stroke-[#4f46e5] dark:stroke-[#6366f1]', ink: 'text-[#4f46e5] dark:text-[#818cf8]', dot: 'info' },
  strained: { stroke: 'stroke-[#d97706]', ink: 'text-[#b45309] dark:text-[#f59e0b]', dot: 'warning' },
  critical: { stroke: 'stroke-[#dc2626] dark:stroke-[#ef4444]', ink: 'text-[#dc2626] dark:text-[#ef4444]', dot: 'critical' },
});

/** Un eslabón de la cadena: el nivel, su recuento y a dónde lleva. */
interface ChainLink {
  id: string;
  label: string;
  value: number;
  icon: LucideIcon;
  href?: string;
  /** Por qué existe este nivel, en cuatro palabras. */
  role: string;
}

export interface PortfolioHealthHeroProps {
  model: PortfolioCommandCenter;
  counts: {
    initiatives: number;
    attentions: number;
    deliverables: number;
    artifacts: number;
  };
  className?: string;
}

export const PortfolioHealthHero: React.FC<PortfolioHealthHeroProps> = ({
  model,
  counts,
  className,
}) => {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const band = model.band ? BAND_VISUALS[model.band] : null;

  const chain: ChainLink[] = [
    { id: 'initiatives', label: EA_LEVELS.initiative.shortPlural, value: counts.initiatives, icon: Landmark, href: '/initiatives', role: 'La necesidad' },
    { id: 'attentions', label: EA_LEVELS.engagementProject.shortPlural, value: counts.attentions, icon: Boxes, href: '/projects', role: 'La respuesta' },
    { id: 'deliverables', label: EA_LEVELS.deliverable.shortPlural, value: counts.deliverables, icon: PackageCheck, href: '/office', role: 'El trabajo' },
    // Los artefactos no tienen pantalla propia: se abren dentro de su proyecto.
    // Un eslabón que no lleva a ningún sitio se pinta como dato, no como botón.
    { id: 'artifacts', label: EA_LEVELS.artifact.plural, value: counts.artifacts, icon: Layers, role: 'El producto' },
  ];

  return (
    <motion.section
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={TRANSITION.enter}
      aria-labelledby="portfolio-health-title"
      className={cn(
        'relative overflow-hidden rounded-3xl border border-gray-200/80 bg-white/85 p-4 backdrop-blur-sm',
        'dark:border-gray-800 dark:bg-gray-900/70 md:p-5',
        className,
      )}
    >
      {/* Iluminación ambiental, no decoración: sitúa la mirada arriba a la
          derecha, que es donde empieza el desglose. `pointer-events-none` para
          que nunca robe un clic a lo que hay debajo. */}
      <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-primary-400/10 blur-3xl dark:bg-primary-500/10" />

      <div className="relative grid gap-5 lg:grid-cols-[auto_1fr_minmax(0,20rem)] lg:items-center">
        {/* 1 · La cifra */}
        <div className="flex flex-col items-center gap-2 lg:items-start">
          <p className={TYPE.labelAccent}>Salud del portafolio</p>
          <RadialGauge
            value={model.health}
            title="Salud del portafolio"
            caption={
              model.governed === 0
                ? 'Nada gobernado todavía'
                : `${model.governed - model.impaired} de ${model.governed} sin incidencia`
            }
            bandLabel={model.band ? PORTFOLIO_BAND_LABELS[model.band] : undefined}
            stroke={band?.stroke}
            ink={band?.ink}
            size={164}
          />
        </div>

        {/* 2 · La cadena. Es la tesis del producto —una necesidad abre un
            proyecto, que abre un entregable, que produce artefactos— y por eso
            se dibuja como cadena y no como cuatro tarjetas sueltas. */}
        <div className="min-w-0">
          <SectionHeader
            as="h2"
            titleId="portfolio-health-title"
            title="Cadena de arquitectura empresarial"
            description="Cada nivel abre el siguiente. Los recuentos son de todo el portafolio."
            compact
          />
          {/*
            Rejilla de dos columnas en el móvil y fila a partir de `sm`. Cuatro
            eslabones de 96 px mínimos no caben en 390 px: se salían de la
            tarjeta y el tercero quedaba cortado por el borde. Las flechas son
            `hidden sm:block`, así que en la rejilla no ocupan celda.
          */}
          <ol className="mt-3 grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:items-stretch">
            {chain.map((link, index) => {
              const Icon = link.icon;
              const Node = link.href ? 'button' : 'div';
              return (
                <React.Fragment key={link.id}>
                  <li className="min-w-0 flex-1">
                    <Node
                      {...(link.href
                        ? {
                            type: 'button' as const,
                            onClick: () => navigate(link.href as string),
                            'aria-label': `${link.value} ${link.label}. Abrir`,
                          }
                        : {})}
                      className={cn(
                        'flex h-full w-full min-w-24 flex-col gap-1 rounded-xl border px-2.5 py-2 text-left transition-all',
                        'border-gray-200 bg-gray-50/70 dark:border-gray-800 dark:bg-gray-950/40',
                        link.href
                          && 'hover:-translate-y-0.5 hover:border-primary-300 hover:bg-white hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:border-primary-800 dark:hover:bg-gray-900',
                      )}
                    >
                      <Icon className="h-4 w-4 text-primary-600 dark:text-primary-400" aria-hidden strokeWidth={2} />
                      <span className="text-xl font-bold leading-none tabular-nums text-gray-900 dark:text-gray-50">
                        {link.value}
                      </span>
                      <span aria-hidden className="truncate text-2xs font-semibold text-gray-700 dark:text-gray-300">
                        {link.label}
                      </span>
                      <span aria-hidden className="truncate text-2xs text-gray-500 dark:text-gray-500">
                        {link.role}
                      </span>
                    </Node>
                  </li>
                  {index < chain.length - 1 && (
                    <li aria-hidden className="hidden self-center text-gray-300 dark:text-gray-700 sm:block">
                      <ArrowRight className="h-3.5 w-3.5" />
                    </li>
                  )}
                </React.Fragment>
              );
            })}
          </ol>
        </div>

        {/* 3 · El desglose. La mitad honesta de la cifra. */}
        <div className="min-w-0 rounded-2xl border border-gray-200 bg-gray-50/80 p-3 dark:border-gray-800 dark:bg-gray-950/50">
          <h3 className={cn(TYPE.label, 'mb-2')}>Qué baja la cifra</h3>
          {model.drags.length === 0 ? (
            <p className="flex items-start gap-2 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#047857] dark:text-[#34d399]" aria-hidden strokeWidth={2} />
              {model.governed === 0
                ? 'Todavía no hay nada gobernado que medir. La cifra aparece con la primera iniciativa.'
                : 'Nada deteriorado: ninguna iniciativa en riesgo, ningún proyecto huérfano y ningún entregable detenido.'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {model.drags.map((drag) => (
                <li key={drag.id} className="flex items-center gap-2 text-xs">
                  <StatusDot tone={drag.level === 'deliverable' ? 'critical' : 'warning'} label={drag.label} />
                  <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">{drag.label}</span>
                  <span className="shrink-0 font-bold tabular-nums text-gray-900 dark:text-gray-100">{drag.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </motion.section>
  );
};

export default PortfolioHealthHero;
