/**
 * El inventario de la Oficina: los agentes, y la ficha de cada uno.
 *
 * Hasta ahora las trece personas estaban declaradas en el código y no había
 * dónde verlas juntas: aparecían de una en una en un tablero, en un charter o
 * firmando una respuesta. Esta pantalla es el reparto completo —quién es cada
 * uno, qué sabe, qué recuerda, con qué modelo trabaja— y el sitio donde una
 * organización lo adapta a lo suyo.
 *
 * Tres niveles de lectura, y son tres a propósito: la **rejilla** para saber
 * quién hay, la **ficha** (`AgentProfileSheet`) para conocer a uno en detalle
 * sin riesgo de tocarlo, y el **formulario** (`AgentProfileEditor`) para
 * cambiarlo. Consultar es lo frecuente; configurar, lo raro. Un único
 * formulario siempre editable haría de cada consulta una ocasión de cambiar por
 * accidente el reparto que atiende a toda la organización.
 *
 * Lo que se configura y lo que no está separado a propósito, y el editor lo
 * dice: el papel de cada agente en la orquestación y el reparto de qué produce
 * y qué revisa son gobierno. Lo demás —nombre, avatar, habilidades,
 * conocimiento, memoria, modelo y carga— es de quien usa el producto.
 */

import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, EmptyState, Input, SectionHeader, Skeleton, cn } from '../components/ui';
import { Network, Search, Sparkles, UserRoundCheck, UsersRound } from 'lucide-react';
import { TYPE } from '../lib/designTokens';
import {
  AgentProfileCard,
  AgentProfileEditor,
  AgentProfileSheet,
  AgentTeamMap,
} from '../components/architectureOffice/agentProfile';
import { useAgentProfiles } from '../hooks/useAgentProfiles';
import { PRODUCT_NAME } from '../lib/eaTerminology';
import type { OfficeAgentId, OfficeAgentProfile } from '../services/architectureOffice';

/**
 * Los cortes del inventario.
 *
 * Son los que se corresponden con una pregunta real —«¿quién dirige el
 * equipo?», «¿qué hemos tocado nosotros?»— y no con un campo cualquiera del
 * modelo. Un filtro por dominio sería trece filtros de un elemento.
 */
type LensId = 'all' | 'orchestration' | 'specialists' | 'customized' | 'disabled';

const LENSES: { id: LensId; label: string; icon: React.ReactNode; matches: (profile: OfficeAgentProfile) => boolean }[] = [
  { id: 'all', label: 'Todos', icon: <UsersRound className="h-3.5 w-3.5" />, matches: () => true },
  {
    id: 'orchestration',
    label: 'Coordinación',
    icon: <Network className="h-3.5 w-3.5" />,
    matches: (profile) => profile.orchestrationRole === 'coordinator'
      || profile.orchestrationRole === 'consolidator'
      || profile.orchestrationRole === 'generalist',
  },
  { id: 'specialists', label: 'Especialistas', icon: <UserRoundCheck className="h-3.5 w-3.5" />, matches: (profile) => profile.orchestrationRole === 'participant' },
  { id: 'customized', label: 'Personalizados', icon: <Sparkles className="h-3.5 w-3.5" />, matches: (profile) => profile.customized },
  { id: 'disabled', label: 'Inactivos', icon: <span className="h-2 w-2 rounded-full bg-current" />, matches: (profile) => !profile.enabled },
];

const AgentsPage: React.FC = () => {
  const { profiles, overrides, loading, notice, save, reset } = useAgentProfiles();
  const [query, setQuery] = useState('');
  const [lens, setLens] = useState<LensId>('all');
  /** El expediente abierto. Independiente del formulario: ver no es editar. */
  const [viewing, setViewing] = useState<OfficeAgentId | null>(null);
  const [editing, setEditing] = useState<OfficeAgentId | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const lensMatch = LENSES.find((entry) => entry.id === lens)?.matches ?? (() => true);
    return profiles.filter((profile) => {
      if (!lensMatch(profile)) return false;
      if (!needle) return true;
      return [profile.alias, profile.role, ...profile.domains, ...profile.skills]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [profiles, query, lens]);

  const customized = profiles.filter((profile) => profile.customized).length;
  const available = profiles.filter((profile) => profile.enabled).length;
  const viewingProfile = profiles.find((profile) => profile.agentId === viewing);
  const editingProfile = profiles.find((profile) => profile.agentId === editing);

  return (
    <div className="min-h-[100dvh] px-4 py-6 pb-24 md:pb-8 md:pl-20 md:pr-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <Card tone="gradient" className="relative space-y-4 overflow-hidden">
          <div className="pointer-events-none absolute -right-20 -top-28 h-64 w-64 rounded-full bg-ai-400/15 blur-3xl" />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="relative min-w-0">
              <p className={TYPE.labelAccent}>{PRODUCT_NAME}</p>
              <h1 className={cn('mt-1', TYPE.pageTitle)}>
                El talento digital de tu Oficina
              </h1>
              <p className={cn('mt-1 max-w-3xl', TYPE.body)}>
                El reparto que atiende cada solicitud. Abre la ficha de cualquiera para ver qué sabe,
                qué recuerda entre encargos y con qué modelo trabaja; lo que le añadas viaja en todos
                sus prompts.
              </p>
            </div>
            <div className="relative grid grid-cols-3 gap-2" aria-label="Resumen del equipo">
              {[
                [profiles.length, 'Agentes', 'text-primary-700 dark:text-primary-300'],
                [available, 'Disponibles', 'text-emerald-700 dark:text-emerald-300'],
                [customized, 'A tu medida', 'text-ai-700 dark:text-ai-300'],
              ].map(([value, label, color]) => (
                <div key={label} className="min-w-20 rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-center shadow-sm backdrop-blur dark:border-white/10 dark:bg-gray-900/60">
                  <strong className={cn('block text-xl leading-none', color as string)}>{value}</strong>
                  <span className="mt-1 block text-2xs text-gray-500 dark:text-gray-400">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[16rem] flex-1">
              <label htmlFor="agents-search" className="sr-only">Buscar un agente</label>
              <Input
                id="agents-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Busca por nombre, rol o dominio"
                leftIcon={<Search className="h-4 w-4" aria-hidden />}
              />
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar el reparto">
              {LENSES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={lens === entry.id}
                  onClick={() => setLens(entry.id)}
                  className={cn(
                    'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-2xs font-semibold transition-colors',
                    'motion-safe:duration-150',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                    lens === entry.id
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700',
                  )}
                >
                  {entry.icon}<span>{entry.label}</span>
                  <span className={cn('rounded-full px-1.5 py-0.5 tabular-nums', lens === entry.id ? 'bg-white/20' : 'bg-gray-200/70 dark:bg-gray-700')}>
                    {profiles.filter(entry.matches).length}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </Card>

        {notice && <Alert tone="warning">{notice}</Alert>}

        <Alert tone="info">
          Las fichas son tuyas: se guardan en tu cuenta y no cambian el reparto de artefactos ni quién
          revisa a quién. Un agente que produce y revisa lo mismo dejaría de ser una revisión.
        </Alert>

        {!loading && <AgentTeamMap profiles={profiles.filter((profile) => profile.enabled)} onSelect={(profile) => setViewing(profile.agentId)} />}

        {/*
          La rejilla llevaba tarjetas con `h3` y ninguna `h2` por encima: para
          quien navega por encabezados, trece fichas colgaban directamente del
          título de la página sin decir de qué eran la lista. El encabezado
          también es donde vive el recuento del filtro activo, que antes sólo
          existía dentro del propio botón del filtro.
        */}
        <SectionHeader
          as="h2"
          title="El reparto completo"
          description={visible.length === profiles.length
            ? `Los ${profiles.length} agentes de la Oficina. Abre una ficha para ver qué sabe y qué recuerda.`
            : `${visible.length} de ${profiles.length} agentes en este filtro.`}
          className="pt-1"
          compact
        />

        {loading ? (
          /*
            Esqueletos y no un `Spinner`: la rejilla de fichas tiene una forma
            conocida de antemano, así que se puede enseñar mientras llega el
            contenido. Un disco girando en medio de la página no dice nada sobre
            lo que va a aparecer, y hace que el salto al llegar los datos se lea
            como un cambio de pantalla en vez de como el final de una carga.
          */
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Cargando las fichas de los agentes">
            {Array.from({ length: 6 }, (_, index) => (
              <Card key={index} className="flex h-56 flex-col gap-3">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-12 w-12 rounded-2xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-36" />
                  </div>
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <div className="mt-auto flex gap-2">
                  <Skeleton className="h-8 flex-1 rounded-md" />
                  <Skeleton className="h-8 flex-1 rounded-md" />
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((profile) => (
              <AgentProfileCard
                key={profile.agentId}
                profile={profile}
                onOpen={() => setViewing(profile.agentId)}
                onEdit={() => setEditing(profile.agentId)}
              />
            ))}
          </div>
        )}

        {!loading && visible.length === 0 && (
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="No encontramos agentes"
            description={query.trim() ? `Ningún perfil coincide con «${query.trim()}». Prueba con otro nombre, rol o dominio.` : 'Ningún agente entra en este filtro.'}
            actions={query.trim() ? <Button variant="secondary" size="sm" onClick={() => setQuery('')}>Limpiar búsqueda</Button> : undefined}
          />
        )}
      </div>

      {/* El expediente. Se cierra al abrir el formulario para que nunca haya dos
          capas sobre el mismo agente diciendo cosas distintas. */}
      {viewingProfile && !editingProfile && (
        <AgentProfileSheet
          profile={viewingProfile}
          onClose={() => setViewing(null)}
          onEdit={() => setEditing(viewingProfile.agentId)}
        />
      )}

      {editingProfile && (
        <AgentProfileEditor
          profile={editingProfile}
          override={overrides.find((entry) => entry.agentId === editingProfile.agentId)}
          onSave={save}
          onReset={() => reset(editingProfile.agentId)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};

export default AgentsPage;
