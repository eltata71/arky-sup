/**
 * La ficha de un agente, abierta.
 *
 * La tarjeta del inventario resume; esta hoja es el expediente completo: quién
 * es el agente, qué sabe hacer, qué conocimiento de la organización se le ha
 * añadido, qué arrastra en memoria de un encargo al siguiente, con qué modelo
 * trabaja y —lo que ninguna pantalla puede cambiar— qué artefactos produce y
 * cuáles revisa.
 *
 * Es deliberadamente de **sólo lectura**, con un único botón que lleva al
 * formulario. Consultar la ficha de un especialista antes de encargarle algo es
 * la operación frecuente; configurarlo es la rara. Mezclar las dos en un
 * formulario siempre editable convierte una consulta en un riesgo de cambio
 * accidental sobre el reparto que atiende a toda la organización.
 *
 * Lo heredado y lo añadido se distinguen a la vista. Un lector que no puede
 * saber si «usa el canal de corredores sobre AS/400» viene del producto o lo
 * escribió un compañero suyo la semana pasada no puede juzgar la respuesta que
 * el agente firme con ello.
 */

import React from 'react';
import { BrainCircuit, Cpu, Network, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Badge, Button, Drawer, cn } from '../../ui';
import {
  getOfficeArchitectureContext,
  inheritedProfileEntries,
  type OfficeAgentProfile,
} from '../../../services/architectureOffice/agents'; // the cards' door, not the barrel (F6-05)
import { AgentProfileAvatar } from './AgentProfileAvatar';

const TIER_LABELS: Record<OfficeAgentProfile['modelTier'], string> = {
  quick: 'Rápido',
  default: 'Estándar',
  deep: 'Razonamiento',
};

const TIER_HINTS: Record<OfficeAgentProfile['modelTier'], string> = {
  quick: 'Respuestas cortas y mecánicas, al menor coste.',
  default: 'El equilibrio con el que trabaja la Oficina.',
  deep: 'Para consistencia entre artefactos y revisiones completas.',
};

const ORCHESTRATION_LABELS: Record<OfficeAgentProfile['orchestrationRole'], string> = {
  generalist: 'Generalista',
  coordinator: 'Coordina el equipo',
  consolidator: 'Consolida la recomendación',
  participant: 'Especialista',
};

const ORCHESTRATION_HINTS: Record<OfficeAgentProfile['orchestrationRole'], string> = {
  generalist: 'Atiende de una en una las preguntas de un solo dominio, como la ayuda de los formularios.',
  coordinator: 'Recibe la solicitud, decide qué dominios toca y reparte el trabajo.',
  consolidator: 'Reúne los análisis de los especialistas y firma una única recomendación.',
  participant: 'Aporta su dominio cuando la solicitud lo toca.',
};

const CAPABILITY_LABELS: Record<string, string> = {
  consult: 'Consultar',
  generate: 'Generar artefactos',
  validate: 'Revisar artefactos',
  orchestrate: 'Orquestar',
  consolidate: 'Consolidar',
  report: 'Reportar',
};

const SECTION_TITLE = 'text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400';

/** Un bloque de la ficha. Nunca se oculta: un apartado vacío también informa. */
const Section: React.FC<{ title: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  hint,
  icon,
  children,
}) => (
  <section className="space-y-1.5 rounded-2xl border border-gray-100 bg-white/70 p-3.5 dark:border-gray-800 dark:bg-gray-900/40">
    <h3 className={cn(SECTION_TITLE, 'flex items-center gap-1.5')}>{icon}{title}</h3>
    {hint && <p className="text-2xs leading-snug text-gray-500 dark:text-gray-400">{hint}</p>}
    {children}
  </section>
);

/**
 * Una lista de frases, marcando cuáles son de la organización.
 *
 * `inheritedCount` es cuántas de las primeras entradas vienen del producto:
 * `resolveAgentProfile` concatena las del persona y después las añadidas, así
 * que el índice basta y no hace falta guardar la procedencia en cada entrada.
 */
const ProvenanceList: React.FC<{
  values: readonly string[];
  inheritedCount: number;
  empty: string;
}> = ({ values, inheritedCount, empty }) => {
  if (values.length === 0) {
    return (
      <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
        {empty}
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {values.map((value, index) => {
        const added = index >= inheritedCount;
        return (
          <li
            key={`${value}-${index}`}
            className={cn(
              'flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-sm leading-relaxed',
              added
                ? 'bg-primary-50/70 text-gray-800 dark:bg-primary-950/30 dark:text-gray-100'
                : 'bg-gray-50 text-gray-700 dark:bg-gray-900/50 dark:text-gray-200',
            )}
          >
            <span className="min-w-0 flex-1">{value}</span>
            {added && <Badge tone="ai" size="xs">De tu organización</Badge>}
          </li>
        );
      })}
    </ul>
  );
};

export interface AgentProfileSheetProps {
  /** El perfil resuelto: la persona del producto con lo configurado aplicado. */
  profile: OfficeAgentProfile;
  onClose: () => void;
  onEdit: () => void;
}

export const AgentProfileSheet: React.FC<AgentProfileSheetProps> = ({
  profile,
  onClose,
  onEdit,
}) => {
  const inherited = inheritedProfileEntries(profile.agentId);
  const standards = getOfficeArchitectureContext().standards
    .filter((standard) => profile.standardIds.includes(standard.id));

  return (
    <Drawer
      isOpen
      onClose={onClose}
      side="right"
      size="xl"
      hideHeader
      ariaLabel={`Ficha de ${profile.alias}`}
      footer={(
        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs text-gray-500 dark:text-gray-400">
            El reparto de artefactos y el papel en la orquestación no se configuran: son gobierno.
          </p>
          <Button variant="primary" size="sm" onClick={onEdit}>
            Configurar ficha
          </Button>
        </div>
      )}
    >
      <div className="space-y-5 bg-gray-50/70 px-4 py-5 dark:bg-gray-950/50 sm:px-6">
        <header className="relative flex items-start gap-4 overflow-hidden rounded-3xl border border-primary-200/70 bg-gradient-to-br from-primary-50 via-white to-ai-50 p-5 dark:border-primary-900/60 dark:from-primary-950/50 dark:via-gray-900 dark:to-ai-950/40">
          <div className="pointer-events-none absolute -right-12 -top-20 h-48 w-48 rounded-full bg-ai-400/15 blur-3xl" />
          <AgentProfileAvatar profile={profile} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="text-lg font-bold leading-tight text-gray-900 dark:text-gray-50">
                {profile.alias}
              </h2>
              {profile.customized && <Badge tone="ai" size="xs">Personalizado</Badge>}
              <Badge tone={profile.enabled ? 'success' : 'gray'} size="xs">
                {profile.enabled ? 'Disponible' : 'Inactivo'}
              </Badge>
            </div>
            <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">{profile.role}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {profile.domains.map((domain) => (
                <Badge key={domain} tone="gray" size="xs" outline>{domain}</Badge>
              ))}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar ficha" className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-white/70 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-gray-800 dark:hover:text-white">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <Section title="Cómo trabaja" icon={<Sparkles className="h-3.5 w-3.5 text-ai-500" />}>
          <p className="whitespace-pre-wrap rounded-xl bg-gray-50 px-3 py-2.5 text-sm leading-relaxed text-gray-700 dark:bg-gray-900/50 dark:text-gray-200">
            {profile.instruction}
          </p>
        </Section>

        <div className="grid gap-3 sm:grid-cols-2">
          <Section title="Papel en el equipo" icon={<Network className="h-3.5 w-3.5 text-primary-500" />} hint={ORCHESTRATION_HINTS[profile.orchestrationRole]}>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
              {ORCHESTRATION_LABELS[profile.orchestrationRole]}
            </p>
          </Section>
          <Section title="Modelo" icon={<Cpu className="h-3.5 w-3.5 text-sky-500" />} hint={TIER_HINTS[profile.modelTier]}>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
              {TIER_LABELS[profile.modelTier]} · hasta {profile.maxConcurrentTasks} tarea(s) a la vez
            </p>
          </Section>
        </div>

        <Section title="Capacidades" icon={<Settings2 className="h-3.5 w-3.5 text-primary-500" />}>
          <div className="flex flex-wrap gap-1.5">
            {profile.capabilities.map((capability) => (
              <Badge key={capability} tone="info" size="xs" outline>
                {CAPABILITY_LABELS[capability] ?? capability}
              </Badge>
            ))}
          </div>
        </Section>

        <Section
          title="Habilidades"
          icon={<BrainCircuit className="h-3.5 w-3.5 text-primary-500" />}
          hint="Lo que el agente sabe hacer. Lo marcado se ha añadido en esta organización."
        >
          <ProvenanceList
            values={profile.skills}
            inheritedCount={inherited.skills}
            empty="Sin habilidades declaradas."
          />
        </Section>

        <Section
          title="Conocimiento de la organización"
          icon={<Sparkles className="h-3.5 w-3.5 text-ai-500" />}
          hint="Hechos de esta compañía que el agente aplica en cada respuesta."
        >
          <ProvenanceList
            values={profile.knowledge}
            inheritedCount={inherited.knowledge}
            empty="Sin conocimiento propio: parte de los estándares de la Oficina y del contexto de cada solicitud."
          />
        </Section>

        <Section
          title="Memoria"
          hint="Lo que arrastra de un encargo al siguiente: decisiones, convenciones, vetos."
        >
          <ProvenanceList
            values={profile.memory}
            inheritedCount={inherited.memory}
            empty="Sin memoria propia. Cada solicitud parte de su contexto."
          />
        </Section>

        <Section
          title="Estándares que sostiene"
          icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />}
          hint="Vienen del cuerpo de estándares de la Oficina y no se configuran desde una pantalla."
        >
          {standards.length === 0 ? (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
              Ninguno asignado.
            </p>
          ) : (
            <ul className="space-y-1">
              {standards.map((standard) => (
                <li key={standard.id} className="rounded-lg bg-gray-50 px-2.5 py-1.5 dark:bg-gray-900/50">
                  <p className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
                    {standard.id}
                  </p>
                  <p className="text-xs leading-relaxed text-gray-700 dark:text-gray-200">
                    {standard.statement}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="grid gap-3 sm:grid-cols-2">
          <Section
            title="Puede producir"
            hint="Asignado por la Oficina. Un agente que produjera y revisara lo mismo apagaría la revisión."
          >
            {profile.producesArtifactTypes.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">Ningún artefacto: no es un rol autor.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {profile.producesArtifactTypes.map((type) => (
                  <Badge key={type} tone="primary" size="xs" outline>{type}</Badge>
                ))}
              </div>
            )}
          </Section>
          <Section title="Puede revisar">
            {profile.reviewsArtifactTypes.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">Ningún artefacto: no es un rol revisor.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {profile.reviewsArtifactTypes.map((type) => (
                  <Badge key={type} tone="warning" size="xs" outline>{type}</Badge>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </Drawer>
  );
};

export default AgentProfileSheet;
