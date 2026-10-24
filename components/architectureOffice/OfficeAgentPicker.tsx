import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
import React from 'react';
import { useAgentDisplayRole } from '../../hooks/useAgentDisplayName';
import {
  OFFICE_AGENT_PERSONAS,
  type OfficeAgentPersona,
} from '../../services/architectureOffice/domain/officeAgentPersonas';

interface OfficeAgentPickerProps {
  onSelect: (persona: OfficeAgentPersona) => void;
}

// El botón escribe la mención, y una mención se resuelve con el alias de fábrica
// (el nombre estable). El rol que se muestra es el de la ficha (21.3).
export const OfficeAgentPicker: React.FC<OfficeAgentPickerProps> = ({ onSelect }) =>{ const t = useUiTranslation(); const displayRole = useAgentDisplayRole(); return  (
  <div className="border-b border-gray-200 pb-3 dark:border-gray-800">
    <p className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
      {t("ui.selecciona-una-persona-o-esc.8cdfa7")} <code>{t("ui.nombre.3f0597")}</code> {t("ui.en-tu-mensaje.953cda")}
    </p>
    <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t("ui.personas-de-la-oficina-de-ar.b35b72")}>
      {Object.values(OFFICE_AGENT_PERSONAS).map((persona) => (
        <button
          key={persona.id}
          type="button"
          onClick={() => onSelect(persona)}
          title={displayRole(persona.id)}
          className="shrink-0 rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary-800 transition hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-200 dark:hover:bg-primary-500/20"
          aria-label={`${persona.alias} — ${displayRole(persona.id)}`}
        >
          {persona.alias}
        </button>
      ))}
    </div>
  </div>
); };

export default OfficeAgentPicker;
