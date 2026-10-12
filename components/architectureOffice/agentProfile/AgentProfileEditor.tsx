import { useUiTranslation } from '../../../lib/i18n/UiTranslationContext';
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
} from '../../../services/architectureOffice/agents'; // the cards' door, not the barrel (F6-05)
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
  const t = useUiTranslation();
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
                aria-label={t("uiTemplate.quitar-p0.ddd8ce", { p0: String(entry) })}
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
  const translateConfig = useUiTranslation();
  const t = useUiTranslation();
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
      setError(result.message ?? t("uiMessage.no-se-pudo-guardar-la-ficha.08fed8"));
      return;
    }
    onClose();
  }, [onSave, onClose, profile.agentId, alias, role, avatar, instruction, skills, knowledge, memory, modelTier, maxConcurrentTasks, enabled, t]);

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
                {t("ui.ficha-del-agente.e24e18")}
              </p>
              <h2 id="agent-profile-title" className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {profile.alias}
              </h2>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{profile.role}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>{t("sdd.close")}</Button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {error && <Alert tone="danger">{error}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="agent-alias" className={labelClass}>{t("users.name")}</label>
              <Input
                id="agent-alias"
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                placeholder={profile.alias}
              />
              <p className="text-2xs text-gray-500 dark:text-gray-400">
                {t("ui.vacio-usa-el-nombre-de-fabri.875e5f")}
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="agent-avatar" className={labelClass}>{t("ui.avatar.7631b2")}</label>
              <Input
                id="agent-avatar"
                value={avatar}
                onChange={(event) => setAvatar(event.target.value)}
                placeholder={t("ui.uno-o-dos-emoji.4a74c9")}
              />
              <p className="text-2xs text-gray-500 dark:text-gray-400">
                {t("ui.solo-emoji-vacio-deja-el-gli.799423")}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="agent-role" className={labelClass}>{t("users.role")}</label>
            <Input
              id="agent-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder={profile.role}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="agent-instruction" className={labelClass}>{t("ui.instruccion.e84bec")}</label>
            <textarea
              id="agent-instruction"
              rows={4}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={profile.instruction}
              className={cn(fieldClass, 'resize-y leading-relaxed')}
            />
            <p className="text-2xs text-gray-500 dark:text-gray-400">
              {t("ui.sustituye-a-la-instruccion-d.2c2fc6")}
            </p>
          </div>

          <EntryList
            id="agent-skills"
            label={t("ui.habilidades.bff903")}
            hint={t("Se suman a sus dominios y capacidades de fábrica, que se muestran arriba.")}
            inherited={profile.skills.slice(0, profile.skills.length - skills.length)}
            values={skills}
            onChange={setSkills}
            placeholder={t("ui.ej-migracion-de-polizas-desd.349ab4")}
          />

          <EntryList
            id="agent-knowledge"
            label={t("ui.conocimiento-de-la-organizac.49dd08")}
            hint={t("Hechos de esta compañía que el agente debe aplicar en cada respuesta.")}
            values={knowledge}
            onChange={setKnowledge}
            placeholder={t("ui.ej-el-canal-de-corredores-fa.13ee8d")}
          />

          <EntryList
            id="agent-memory"
            label={t("ui.memoria.8b1a8b")}
            hint={t("Lo que arrastra entre encargos: decisiones tomadas, convenciones y vetos.")}
            values={memory}
            onChange={setMemory}
            placeholder={t("ui.ej-el-comite-ya-rechazo-expo.e481a9")}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="agent-tier" className={labelClass}>{t("ui.modelo.b3a01b")}</label>
              <select
                id="agent-tier"
                value={modelTier}
                onChange={(event) => setModelTier(event.target.value as ModelTier)}
                className={fieldClass}
              >
                {TIER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{translateConfig(option.label)}</option>
                ))}
              </select>
              <p className="text-2xs text-gray-500 dark:text-gray-400">
                {translateConfig(TIER_OPTIONS.find((option) => option.value === modelTier)?.hint ?? '')}
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="agent-concurrency" className={labelClass}>{t("ui.tareas-simultaneas.9431da")}</label>
              <Input
                id="agent-concurrency"
                type="number"
                min={1}
                max={5}
                value={maxConcurrentTasks}
                onChange={(event) => setMaxConcurrentTasks(Number(event.target.value))}
              />
              <p className="text-2xs text-gray-500 dark:text-gray-400">
                {t("ui.de-1-a-5-el-limite-protege-l.4b4df9")}
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
              {t("ui.disponible-para-la-oficina.2214bc")}
              <span className="block text-2xs text-gray-500 dark:text-gray-400">
                {t("ui.un-agente-inactivo-no-entra.5c6654")}
              </span>
            </span>
          </label>

          {/* La mitad que no se configura, dicha explícitamente. */}
          <Card tone="muted" className="space-y-2">
            <p className={labelClass}>{t("ui.gobierno-no-configurable.ea8d66")}</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="gray" size="xs" outline>{t("ui.papel.303c68")} {profile.orchestrationRole}</Badge>
              <Badge tone="gray" size="xs" outline>{t("ui.produce.a05840")} {profile.producesArtifactTypes.length} {t("ui.tipo-s.058563")}</Badge>
              <Badge tone="gray" size="xs" outline>{t("ui.revisa.37e765")} {profile.reviewsArtifactTypes.length} {t("ui.tipo-s.058563")}</Badge>
              {profile.standardIds.map((standard) => (
                <Badge key={standard} tone="info" size="xs" outline>{standard}</Badge>
              ))}
            </div>
            <p className="text-2xs leading-relaxed text-gray-600 dark:text-gray-400">
              {t("ui.quien-produce-y-quien-revisa.4df37e")}
            </p>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
            <Button
              variant="ghost"
              onClick={() => { void onReset().then(onClose); }}
              disabled={!profile.customized || saving}
            >
              {t("ui.restaurar-valores-de-fabrica.f20434")}
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose} disabled={saving}>{t("ui.cancelar.c111e0")}</Button>
              <Button variant="primary" onClick={submit} loading={saving}>{t("ui.guardar-ficha.8115fb")}</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentProfileEditor;
