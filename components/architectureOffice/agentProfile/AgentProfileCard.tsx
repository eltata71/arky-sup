/**
 * La ficha de un agente, en su forma de tarjeta.
 *
 * Trece especialistas es más de lo que nadie recuerda como lista de nombres, y
 * el producto ya resolvió eso una vez: `PersonaAvatar` da a cada uno un color y
 * un glifo estables. Aquí se respeta —el avatar configurado sustituye al glifo,
 * nunca al color— para que reconocer a Elena en el tablero siga funcionando
 * después de que alguien le ponga un emoji.
 *
 * La tarjeta muestra lo que el agente *es* y lo que se le ha *añadido*, con la
 * distinción visible: un badge marca al agente personalizado, porque saber que
 * una respuesta viene de una configuración local es parte de poder confiar en
 * ella.
 */

import React from 'react';
import { BrainCircuit, Cpu, Layers3, Settings2, Sparkles, Target } from 'lucide-react';
import { motion } from 'motion/react';
import { Badge, Button, Card, StatusDot, cn } from '../../ui';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import type { OfficeAgentProfile } from '../../../services/architectureOffice';
import { AgentProfileAvatar } from './AgentProfileAvatar';

const TIER_LABELS: Record<OfficeAgentProfile['modelTier'], string> = {
  quick: 'Modelo rápido',
  default: 'Modelo estándar',
  deep: 'Modelo de razonamiento',
};

const ROLE_LABELS: Record<OfficeAgentProfile['orchestrationRole'], string> = {
  generalist: 'Generalista',
  coordinator: 'Coordina',
  consolidator: 'Consolida',
  participant: 'Especialista',
};

export interface AgentProfileCardProps {
  profile: OfficeAgentProfile;
  /** Abre el expediente completo. La tarjeta entera es el objetivo del clic. */
  onOpen: () => void;
  onEdit: () => void;
}

export const AgentProfileCard: React.FC<AgentProfileCardProps> = ({ profile, onOpen, onEdit }) => {
  const reducedMotion = useReducedMotion();
  const knowledgeScore = Math.min(100, profile.standardIds.length * 16 + profile.knowledge.length * 12);
  const memoryScore = Math.min(100, profile.memory.length * 20);
  return (
  <motion.article whileHover={reducedMotion ? undefined : { y: -4 }} transition={{ duration: 0.18 }} className="h-full">
  <Card className={cn('group relative flex h-full flex-col gap-3 overflow-hidden border-gray-200/80 transition-shadow hover:shadow-pop dark:border-gray-800', !profile.enabled && 'opacity-60')}>
    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-400/70 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Ver la ficha de ${profile.alias}, ${profile.role}`}
      className="flex items-start gap-3 rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <AgentProfileAvatar profile={profile} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="text-base font-bold text-gray-900 transition-colors group-hover:text-primary-700 dark:text-gray-100 dark:group-hover:text-primary-300">{profile.alias}</h3>
          {/* La disponibilidad la dice la línea de estado de debajo, en los dos
              sentidos. Un badge «Inactivo» aquí sería el mismo hecho contado
              dos veces en dos vocabularios distintos dentro de la misma
              tarjeta. */}
          {profile.customized && <Badge tone="ai" size="xs">Personalizado</Badge>}
        </div>
        <p className="mt-0.5 text-xs leading-snug text-gray-600 dark:text-gray-300">{profile.role}</p>
        {/*
          La disponibilidad, escrita. El punto verde del avatar ya la dice a
          quien lo ve; esto es el mismo hecho para quien no distingue el color
          —y es el hecho que decide si este agente va a atender la próxima
          solicitud, así que no puede vivir sólo en un píxel de 10 px.
        */}
        <span className="mt-1 flex">
          <StatusDot
            tone={profile.enabled ? 'success' : 'neutral'}
            label={profile.enabled ? 'Disponible' : 'Fuera del reparto'}
            showLabel
          />
        </span>
      </div>
    </button>

    {/*
      El dominio es lo que decide a quién se le encarga qué, así que va en la
      tarjeta y no sólo dentro del expediente: elegir especialista sin ver su
      dominio obliga a abrir trece fichas para responder una pregunta.
    */}
    {profile.domains.length > 0 && (
      <div>
        <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
          <Target className="h-3.5 w-3.5" aria-hidden />Dominio
        </p>
        <p className="mt-1 flex flex-wrap gap-1">
          {profile.domains.slice(0, 3).map((domain) => (
            <span key={domain} className="rounded-md bg-primary-50 px-1.5 py-0.5 text-2xs font-medium text-primary-700 dark:bg-primary-950/50 dark:text-primary-300">
              {domain}
            </span>
          ))}
          {profile.domains.length > 3 && (
            <span className="px-1 py-0.5 text-2xs text-gray-500">+{profile.domains.length - 3}</span>
          )}
        </p>
      </div>
    )}

    <div className="flex flex-wrap gap-1.5">
      <Badge tone="primary" size="xs" outline>{ROLE_LABELS[profile.orchestrationRole]}</Badge>
      <Badge tone="info" size="xs" outline>{TIER_LABELS[profile.modelTier]}</Badge>
      <Badge tone="gray" size="xs" outline>{profile.maxConcurrentTasks} tarea(s) a la vez</Badge>
    </div>

    <div className="grid grid-cols-2 gap-2" aria-label="Indicadores del agente">
      <div className="rounded-xl bg-gray-50 p-2.5 dark:bg-gray-800/55">
        <div className="flex items-center justify-between gap-2 text-2xs text-gray-500 dark:text-gray-400"><span className="inline-flex items-center gap-1"><BrainCircuit className="h-3.5 w-3.5" />Conocimiento</span><strong className="text-gray-700 dark:text-gray-200">{profile.standardIds.length + profile.knowledge.length}</strong></div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"><span className="block h-full rounded-full bg-gradient-to-r from-primary-500 to-sky-400" style={{ width: `${knowledgeScore}%` }} /></div>
      </div>
      <div className="rounded-xl bg-gray-50 p-2.5 dark:bg-gray-800/55">
        <div className="flex items-center justify-between gap-2 text-2xs text-gray-500 dark:text-gray-400"><span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" />Memoria</span><strong className="text-gray-700 dark:text-gray-200">{profile.memory.length}</strong></div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"><span className="block h-full rounded-full bg-gradient-to-r from-ai-500 to-pink-400" style={{ width: `${memoryScore}%` }} /></div>
      </div>
    </div>

    <dl className="space-y-2 text-xs">
      <div>
        <dt className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400"><Cpu className="h-3.5 w-3.5" />Habilidades</dt>
        <dd className="mt-1 flex flex-wrap gap-1">
          {profile.skills.slice(0, 4).map((skill) => <span key={skill} className="rounded-md bg-gray-100 px-1.5 py-0.5 text-gray-700 dark:bg-gray-800 dark:text-gray-200">{skill}</span>)}
          {profile.skills.length > 4 && <span className="px-1 py-0.5 text-gray-500">+{profile.skills.length - 4}</span>}
        </dd>
      </div>
      <div>
        <dt className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400"><Layers3 className="h-3.5 w-3.5" />Cobertura gobernada</dt>
        <dd className="mt-0.5 text-gray-700 dark:text-gray-200">
          {profile.producesArtifactTypes.length} tipo(s) · {profile.reviewsArtifactTypes.length} tipo(s)
        </dd>
      </div>
    </dl>

    <div className="mt-auto flex gap-2 pt-1">
      <Button variant="primary" size="sm" onClick={onOpen} className="flex-1">
        Ver ficha
      </Button>
      <Button variant="secondary" size="sm" onClick={onEdit} className="flex-1">
        <Settings2 className="h-3.5 w-3.5" aria-hidden /> Configurar
      </Button>
    </div>
  </Card>
  </motion.article>
  );
};

export default AgentProfileCard;
