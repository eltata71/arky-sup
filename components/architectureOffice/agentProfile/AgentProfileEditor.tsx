/**
 * El formulario donde se configura un agente.
 *
 * Lo que se puede cambiar y lo que no está separado a la vista, y no por
 * estética: el reparto de artefactos que un agente produce o revisa, y su papel
 * en la orquestación, son **gobierno**, no preferencia. Si desde aquí se
 * pudiera hacer que el mismo agente produjera y revisara su propio artefacto,
 * la separación de funciones —la razón por la que existe una oficina de
 * arquitectura y no un generador— se apagaría con un desplegable. Así que esa
 * mitad se muestra como lo que es: la ficha del producto, en sólo lectura.
 *
 * Las tres listas —habilidades, conocimiento y memoria— son **aditivas**:
 * lo que se escribe aquí se suma a lo que el agente ya sabe. Enseñarle a Sofía
 * el canal de corredores de esta compañía no puede hacerle olvidar ACORD.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Input, cn } from '../../ui';
import { Plus, Trash2 } from 'lucide-react';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { PersonaAvatar } from '../PersonaAvatar';
import {
  MAX_PROFILE_ENTRIES,
  type OfficeAgentProfile,
  type OfficeAgentProfileInput,
  type OfficeAgentProfileOverride,
} from '../../../services/architectureOffice';
import type { ModelTier } from '../../../lib/ai/modelCatalog';

const TIER_OPTIONS: { value: ModelTier; label: string; hint: string }[] = [
  { value: 'quick', label: 'Rápido', hint: 'Respuestas cortas y mecánicas. El más barato.' },
  { value: 'default', label: 'Estándar', hint: 'El equilibrio por defecto para trabajo de arquitectura.' },
  { value: 'deep', label: 'Razonamiento', hint: 'Para consistencia entre artefactos y revisiones de rúbrica completa.' },
];

const fieldClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const labelClass = 'text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400';

export interface AgentProfileEditorProps {
  profile: OfficeAgentProfile;
  /** Lo guardado hoy, para que el formulario abra con ello y no con lo resuelto. */
  override?: OfficeAgentProfileOverride;
  onSave: (input: Omit<OfficeAgentProfileInput, 'userId'>) => Promise<{ outcome: string; message?: string }>;
  onReset: () => Promise<void>;
  onClose: () => void;
}

/** Una lista editable de frases cortas: habilidades, conocimiento o memoria. */
const EntryList: React.FC<{
  id: string;
  label: string;
  hint: string;
  /** Lo que el agente ya trae de fábrica; se muestra pero no se edita. */
  inherited?: readonly string[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}> = ({ id, label, hint, inherited = [], values, onChange, placeholder }) => {
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const trimmed = draft.trim();
    if (!trimmed || values.includes(trimmed) || values.length >= MAX_PROFILE_ENTRIES) return;
    onChange([...values, trimmed]);
    setDraft('');
  };
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={labelClass}>{label}</label>
      <p className="text-2xs text-gray-500 dark:text-gray-400">{hint}</p>
      {inherited.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {inherited.map((entry) => (
            <Badge key={entry} tone="gray" size="xs" outline>{entry}</Badge>
          ))}
        </div>
      )}
      {values.length > 0 && (
        <ul className="space-y-1">
          {values.map((entry) => (
            <li key={entry} className="flex items-start gap-2 rounded-lg bg-gray-50 px-2 py-1 dark:bg-gray-900/50">
              <span className="min-w-0 flex-1 text-sm leading-relaxed text-gray-700 dark:text-gray-200">{entry}</span>
              <button
                type="button"
                aria-label={`Quitar: ${entry}`}
                onClick={() => onChange(values.filter((item) => item !== entry))}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button variant="secondary" size="sm" onClick={add} disabled={!draft.trim() || values.length >= MAX_PROFILE_ENTRIES}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
};

export const AgentProfileEditor: React.FC<AgentProfileEditorProps> = ({
  profile,
  override,
  onSave,
  onReset,
  onClose,
}) => {
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  const [alias, setAlias] = useState(override?.alias ?? '');
  const [role, setRole] = useState(override?.role ?? '');
  const [avatar, setAvatar] = useState(override?.avatar ?? '');
  const [instruction, setInstruction] = useState(override?.instruction ?? '');
  const [skills, setSkills] = useState<string[]>(override?.skills ?? []);
  const [knowledge, setKnowledge] = useState<string[]>(override?.knowledge ?? []);
  const [memory, setMemory] = useState<string[]>(override?.memory ?? []);
  const [modelTier, setModelTier] = useState<ModelTier>(override?.modelTier ?? 'default');
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(
    override?.maxConcurrentTasks ?? profile.maxConcurrentTasks,
  );
  const [enabled, setEnabled] = useState(override?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setError(null); }, [alias, avatar, modelTier, maxConcurrentTasks]);

  const submit = useCallback(async () => {
    setSaving(true);
    const result = await onSave({
      agentId: profile.agentId,
      alias: alias.trim() || undefined,
      role: role.trim() || undefined,
      avatar: avatar.trim() || undefined,
      instruction: instruction.trim() || undefined,
      skills,
      knowledge,
      memory,
      modelTier,
      maxConcurrentTasks,
      enabled,
    });
    setSaving(false);
    if (result.outcome === 'rejected') {
      setError(result.message ?? 'No se pudo guardar la ficha.');
      return;
    }
    onClose();
  }, [onSave, onClose, profile.agentId, alias, role, avatar, instruction, skills, knowledge, memory, modelTier, maxConcurrentTasks, enabled]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-profile-title"
    >
      <div
        ref={dialogRef}
        className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-pop dark:bg-gray-900"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex min-w-0 gap-3">
            <PersonaAvatar personaId={profile.agentId} size="md" decorative />
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-widest-2 text-primary-600 dark:text-primary-400">
                Ficha del agente
              </p>
              <h2 id="agent-profile-title" className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {profile.alias}
              </h2>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{profile.role}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Cerrar</Button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {error && <Alert tone="danger">{error}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="agent-alias" className={labelClass}>Nombre</label>
              <Input
                id="agent-alias"
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                placeholder={profile.alias}
              />
              <p className="text-2xs text-gray-500 dark:text-gray-400">
                Vacío usa el nombre de fábrica. Las menciones con @ siguen resolviendo por el alias original.
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="agent-avatar" className={labelClass}>Avatar</label>
              <Input
                id="agent-avatar"
                value={avatar}
                onChange={(event) => setAvatar(event.target.value)}
                placeholder="Uno o dos emoji"
              />
              <p className="text-2xs text-gray-500 dark:text-gray-400">
                Sólo emoji. Vacío deja el glifo de su dominio, que es estable y se reconoce en los tableros.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="agent-role" className={labelClass}>Rol</label>
            <Input
              id="agent-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder={profile.role}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="agent-instruction" className={labelClass}>Instrucción</label>
            <textarea
              id="agent-instruction"
              rows={4}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={profile.instruction}
              className={cn(fieldClass, 'resize-y leading-relaxed')}
            />
            <p className="text-2xs text-gray-500 dark:text-gray-400">
              Sustituye a la instrucción de fábrica cuando la escribes. Es lo primero que lee el agente
              en cada tarea, así que dile cómo trabajar, no qué contestar.
            </p>
          </div>

          <EntryList
            id="agent-skills"
            label="Habilidades"
            hint="Se suman a sus dominios y capacidades de fábrica, que se muestran arriba."
            inherited={profile.skills.slice(0, profile.skills.length - skills.length)}
            values={skills}
            onChange={setSkills}
            placeholder="Ej. Migración de pólizas desde Guidewire"
          />

          <EntryList
            id="agent-knowledge"
            label="Conocimiento de la organización"
            hint="Hechos de esta compañía que el agente debe aplicar en cada respuesta."
            values={knowledge}
            onChange={setKnowledge}
            placeholder="Ej. El canal de corredores factura sobre AS/400 y no se sustituye"
          />

          <EntryList
            id="agent-memory"
            label="Memoria"
            hint="Lo que arrastra entre encargos: decisiones tomadas, convenciones y vetos."
            values={memory}
            onChange={setMemory}
            placeholder="Ej. El comité ya rechazó exponer PHI fuera del dominio clínico"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="agent-tier" className={labelClass}>Modelo</label>
              <select
                id="agent-tier"
                value={modelTier}
                onChange={(event) => setModelTier(event.target.value as ModelTier)}
                className={fieldClass}
              >
                {TIER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <p className="text-2xs text-gray-500 dark:text-gray-400">
                {TIER_OPTIONS.find((option) => option.value === modelTier)?.hint}
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="agent-concurrency" className={labelClass}>Tareas simultáneas</label>
              <Input
                id="agent-concurrency"
                type="number"
                min={1}
                max={5}
                value={maxConcurrentTasks}
                onChange={(event) => setMaxConcurrentTasks(Number(event.target.value))}
              />
              <p className="text-2xs text-gray-500 dark:text-gray-400">
                De 1 a 5. El límite protege la cuota del proveedor: subirlo no acelera un encargo.
              </p>
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-200">
              Disponible para la Oficina
              <span className="block text-2xs text-gray-500 dark:text-gray-400">
                Un agente inactivo no entra en los equipos ni recibe tareas. No se borra: los encargos
                que ya lo nombran seguirían siendo ilegibles sin él.
              </span>
            </span>
          </label>

          {/* La mitad que no se configura, dicha explícitamente. */}
          <Card tone="muted" className="space-y-2">
            <p className={labelClass}>Gobierno · no configurable</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="gray" size="xs" outline>Papel: {profile.orchestrationRole}</Badge>
              <Badge tone="gray" size="xs" outline>Produce {profile.producesArtifactTypes.length} tipo(s)</Badge>
              <Badge tone="gray" size="xs" outline>Revisa {profile.reviewsArtifactTypes.length} tipo(s)</Badge>
              {profile.standardIds.map((standard) => (
                <Badge key={standard} tone="info" size="xs" outline>{standard}</Badge>
              ))}
            </div>
            <p className="text-2xs leading-relaxed text-gray-600 dark:text-gray-400">
              Quién produce y quién revisa cada artefacto no es una preferencia: es la separación de
              funciones que hace que una revisión signifique algo. La decide el enrutador de la
              Oficina a partir de esta ficha de producto.
            </p>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
            <Button
              variant="ghost"
              onClick={() => { void onReset().then(onClose); }}
              disabled={!profile.customized || saving}
            >
              Restaurar valores de fábrica
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
              <Button variant="primary" onClick={submit} loading={saving}>Guardar ficha</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentProfileEditor;
