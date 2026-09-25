/**
 * Cómo trabaja el equipo: coordinación, especialistas y consolidación, en el
 * orden en que interviene cada uno.
 *
 * No es un organigrama. Es el **camino que recorre una solicitud**: alguien la
 * entiende y la reparte, varios la resuelven en paralelo dentro de su dominio,
 * y alguien firma una respuesta única después de comprobarla. Ese recorrido es
 * la tesis del producto —una oficina, no un generador— y hasta que se dibuja
 * nadie la ve: trece nombres en una rejilla se leen como trece chatbots.
 *
 * ## Qué añade cada cosa, y por qué no hay más
 *
 * - **Las etapas van numeradas y con su verbo.** «01 · Entiende» dice lo que
 *   pasa ahí; el nombre del rol solo («Coordinación») nombra un puesto y no una
 *   acción, que es lo que hay que entender la primera vez.
 * - **El conector viaja en la dirección de la delegación.** Se anima una sola
 *   vez al entrar y se detiene: una animación en bucle permanente en una
 *   pantalla de configuración es ruido que no se apaga nunca, y consume batería
 *   mientras alguien lee una ficha.
 * - **Al señalar a una persona se atenúa lo que no es su etapa**, y se apaga el
 *   conector que no le toca. Es la afirmación que la pantalla hace —que cada
 *   agente ocupa un lugar del recorrido y entrega a otro— y verla es más rápido
 *   que leerla. Se dispara también con el foco de teclado, no sólo con el ratón.
 * - **La capacidad declarada es dato real**, leído de las fichas: cuántos
 *   agentes hay disponibles, cuántos dominios cubren entre todos y cuántas
 *   tareas simultáneas admiten sumadas. `DEFAULT_MAX_SPECIALISTS` es el límite
 *   que la orquestación aplica de verdad, no una cifra decorativa.
 *
 * Lo que no hay es un indicador de «carga ahora mismo»: esta pantalla configura
 * el reparto, no lo observa. Esa medición existe y vive donde corresponde, en
 * `SpecialistLoadPanel`, junto a los encargos que la producen.
 */

import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, Cpu, Layers3, Network, ShieldCheck, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { DURATION_S, EASING, TRANSITION } from '../../../lib/designTokens';
import { cn } from '../../ui';
import {
  DEFAULT_MAX_SPECIALISTS,
  type OfficeAgentProfile,
} from '../../../services/architectureOffice/agents'; // the cards' door, not the barrel (F6-05)
import { AgentProfileAvatar } from './AgentProfileAvatar';

export interface AgentTeamMapProps {
  profiles: OfficeAgentProfile[];
  onSelect: (profile: OfficeAgentProfile) => void;
}

/** Cuántas caras caben en una etapa antes de resumir el resto en un contador. */
const STAGE_FACES = 7;

type StageId = 'coordination' | 'specialists' | 'consolidation';

/**
 * El conector entre dos etapas.
 *
 * Se atenúa cuando la etapa señalada no lo tiene como salida: al señalar la
 * coordinación queda encendida su entrega hacia los especialistas y apagada la
 * de éstos hacia la consolidación. Atenuar lo que no interviene es lo que hace
 * visible lo que sí.
 */
const StageConnector: React.FC<{ dimmed: boolean; reduced: boolean; tone: string }> = ({ dimmed, reduced, tone }) => (
  <motion.span
    aria-hidden
    initial={reduced ? false : { opacity: 0, x: -4 }}
    animate={{ opacity: dimmed ? 0.25 : 1, x: 0 }}
    transition={{ duration: DURATION_S.base, ease: EASING.enter }}
    className="mx-auto flex rotate-90 items-center self-center lg:rotate-0"
  >
    <span className={cn('hidden h-px w-4 lg:block', tone)} />
    <ArrowRight className={cn('h-5 w-5', tone.replace('bg-', 'text-'))} />
  </motion.span>
);

const TeamStage: React.FC<{
  eyebrow: string;
  title: string;
  purpose: string;
  icon: React.ReactNode;
  profiles: OfficeAgentProfile[];
  dimmed: boolean;
  onSelect: (profile: OfficeAgentProfile) => void;
  onHoverAgent?: (agentId: string | null) => void;
}> = ({ eyebrow, title, purpose, icon, profiles, dimmed, onSelect, onHoverAgent }) => (
  <section
    className={cn(
      'min-w-0 flex-1 rounded-2xl border border-white/60 bg-white/80 p-3 shadow-soft backdrop-blur transition-opacity',
      'dark:border-white/10 dark:bg-gray-900/70',
      dimmed && 'opacity-40',
    )}
  >
    <div className="mb-3 flex items-start gap-2">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700 dark:bg-primary-900/60 dark:text-primary-200">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-2xs font-semibold uppercase tracking-wider-2 text-gray-500 dark:text-gray-400">{eyebrow}</p>
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h3>
        <p className="mt-0.5 text-2xs leading-snug text-gray-500 dark:text-gray-400">{purpose}</p>
      </div>
    </div>
    <div className="flex min-h-12 flex-wrap items-start gap-1.5">
      {profiles.slice(0, STAGE_FACES).map((profile) => (
        <button
          key={profile.agentId}
          type="button"
          onClick={() => onSelect(profile)}
          onMouseEnter={() => onHoverAgent?.(profile.agentId)}
          onMouseLeave={() => onHoverAgent?.(null)}
          onFocus={() => onHoverAgent?.(profile.agentId)}
          onBlur={() => onHoverAgent?.(null)}
          aria-label={`Abrir la ficha de ${profile.alias}, ${profile.role}`}
          className="group w-16 rounded-2xl p-1 transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <span className="flex justify-center"><AgentProfileAvatar profile={profile} /></span>
          <span aria-hidden className="mt-1 block truncate text-center text-2xs font-semibold text-gray-700 transition-colors group-hover:text-primary-700 dark:text-gray-200 dark:group-hover:text-primary-300">
            {profile.alias}
          </span>
          <span aria-hidden className="block truncate text-center text-[9px] leading-tight text-gray-500 dark:text-gray-500">
            {profile.domains[0] ?? profile.role}
          </span>
        </button>
      ))}
      {profiles.length > STAGE_FACES && (
        <span className="mt-1 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-xs font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          +{profiles.length - STAGE_FACES}
        </span>
      )}
    </div>
  </section>
);

/** Un dato de capacidad, con su cifra y lo que la cifra cuenta. */
const CapacityFact: React.FC<{ icon: React.ReactNode; value: React.ReactNode; label: string }> = ({ icon, value, label }) => (
  <div className="flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2 dark:bg-gray-900/60">
    <span className="text-primary-600 dark:text-primary-300" aria-hidden>{icon}</span>
    <span className="min-w-0">
      <strong className="block text-sm font-bold leading-none tabular-nums text-gray-900 dark:text-gray-50">{value}</strong>
      <span className="mt-0.5 block truncate text-2xs text-gray-500 dark:text-gray-400">{label}</span>
    </span>
  </div>
);

export const AgentTeamMap: React.FC<AgentTeamMapProps> = ({ profiles, onSelect }) => {
  const reducedMotion = useReducedMotion();
  /** Qué etapa está señalada. `null` es el estado normal: todo encendido. */
  const [focusedStage, setFocusedStage] = useState<StageId | null>(null);

  const coordinators = profiles.filter((profile) => ['coordinator', 'generalist'].includes(profile.orchestrationRole));
  const specialists = profiles.filter((profile) => profile.orchestrationRole === 'participant');
  const consolidators = profiles.filter((profile) => profile.orchestrationRole === 'consolidator');

  // La cobertura real del reparto: cuántos dominios distintos saben cubrir
  // entre todos, no cuántas etiquetas de dominio hay escritas.
  const domains = new Set(profiles.flatMap((profile) => profile.domains)).size;
  const concurrentCapacity = profiles.reduce((total, profile) => total + profile.maxConcurrentTasks, 0);

  const dim = (stage: StageId) => focusedStage !== null && focusedStage !== stage;

  return (
    <motion.section
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={TRANSITION.enter}
      aria-labelledby="team-map-title"
      className="relative overflow-hidden rounded-3xl border border-primary-200/70 bg-gradient-to-br from-primary-50 via-white to-ai-50 p-4 dark:border-primary-900/60 dark:from-primary-950/35 dark:via-gray-950 dark:to-ai-950/30 md:p-5"
    >
      <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-ai-400/10 blur-3xl" />

      <div className="relative mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-primary-700 dark:text-primary-300">
            <Network className="h-4 w-4" aria-hidden />
            <p className="text-2xs font-bold uppercase tracking-widest-2">Orquestación gobernada</p>
          </div>
          <h2 id="team-map-title" className="mt-1 text-lg font-bold text-gray-950 dark:text-white">
            El camino de una solicitud
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-gray-600 dark:text-gray-300">
            Toda solicitud pasa por las tres etapas. Señala a una persona para ver su lugar en el
            recorrido, o ábrela para conocer su responsabilidad y su experiencia.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-2xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Productor y revisor separados
        </span>
      </div>

      <div
        className="relative grid items-stretch gap-2 lg:grid-cols-[1fr_auto_1.6fr_auto_1fr]"
        onMouseLeave={() => setFocusedStage(null)}
      >
        <TeamStage
          eyebrow="01 · Entiende"
          title="Coordinación"
          purpose="Interpreta la petición y reparte el trabajo por dominio."
          icon={<Network className="h-4 w-4" />}
          profiles={coordinators}
          dimmed={dim('coordination')}
          onSelect={onSelect}
          onHoverAgent={(id) => setFocusedStage(id ? 'coordination' : null)}
        />
        <StageConnector dimmed={focusedStage === 'consolidation'} reduced={reducedMotion} tone="bg-primary-400 dark:bg-primary-500" />
        <TeamStage
          eyebrow="02 · Resuelven"
          title="Especialistas"
          purpose={`Trabajan en paralelo. Como mucho ${DEFAULT_MAX_SPECIALISTS} por solicitud.`}
          icon={<Users className="h-4 w-4" />}
          profiles={specialists}
          dimmed={dim('specialists')}
          onSelect={onSelect}
          onHoverAgent={(id) => setFocusedStage(id ? 'specialists' : null)}
        />
        <StageConnector dimmed={focusedStage === 'coordination'} reduced={reducedMotion} tone="bg-ai-400 dark:bg-ai-500" />
        <TeamStage
          eyebrow="03 · Verifica"
          title="Consolidación"
          purpose="Comprueba la respuesta, la corrige una vez si hace falta, y la firma."
          icon={<CheckCircle2 className="h-4 w-4" />}
          profiles={consolidators}
          dimmed={dim('consolidation')}
          onSelect={onSelect}
          onHoverAgent={(id) => setFocusedStage(id ? 'consolidation' : null)}
        />
      </div>

      {/* La capacidad declarada del reparto. Son cifras leídas de las fichas, no
          una medición de lo que está pasando ahora: esta pantalla configura el
          equipo, y observar su carga es trabajo del tablero de la Oficina. */}
      <div className="relative mt-3 grid gap-2 sm:grid-cols-3">
        <CapacityFact icon={<Users className="h-4 w-4" />} value={profiles.length} label="Agentes disponibles" />
        <CapacityFact icon={<Layers3 className="h-4 w-4" />} value={domains} label="Dominios cubiertos" />
        <CapacityFact icon={<Cpu className="h-4 w-4" />} value={concurrentCapacity} label="Tareas simultáneas admitidas" />
      </div>
    </motion.section>
  );
};

export default AgentTeamMap;
