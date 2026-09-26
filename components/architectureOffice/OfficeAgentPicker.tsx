import React from 'react';
import {
  OFFICE_AGENT_PERSONAS,
  type OfficeAgentPersona,
} from '../../services/architectureOffice/domain/officeAgentPersonas';

interface OfficeAgentPickerProps {
  onSelect: (persona: OfficeAgentPersona) => void;
}

export const OfficeAgentPicker: React.FC<OfficeAgentPickerProps> = ({ onSelect }) => (
  <div className="border-b border-gray-200 pb-3 dark:border-gray-800">
    <p className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
      Selecciona una persona o escribe <code>@Nombre</code> en tu mensaje
    </p>
    <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Personas de la Oficina de Arquitectura">
      {Object.values(OFFICE_AGENT_PERSONAS).map((persona) => (
        <button
          key={persona.id}
          type="button"
          onClick={() => onSelect(persona)}
          title={persona.role}
          className="shrink-0 rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary-800 transition hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-200 dark:hover:bg-primary-500/20"
          aria-label={`${persona.alias} — ${persona.role}`}
        >
          {persona.alias}
        </button>
      ))}
    </div>
  </div>
);

export default OfficeAgentPicker;
