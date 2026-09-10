/**
 * Las piezas que comparten los seis paneles de la ficha de una iniciativa.
 *
 * Estaban dentro de `InitiativeDetailPanels.tsx`, que es el fichero que crece
 * cada vez que la disciplina pide una sección más. Separarlas es lo que permite
 * que los paneles ganen la ayuda del asistente sin empujar ese fichero contra
 * su techo, y de paso deja claro cuál es la forma común: encabezado, entradas
 * actuales, una fila para añadir. Aprender el primero enseña los seis.
 */

import React from 'react';
import { Badge, Card, CardTitle } from '../ui';
import { Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const selectClass = 'rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

export const SectionCard: React.FC<{
  icon: LucideIcon;
  title: string;
  hint: string;
  count?: number;
  id?: string;
  /**
   * Lo que la sección ofrece hacer, arriba a la derecha. Hoy es el botón de
   * asistencia: en el mismo sitio en las seis secciones, que es lo que permite
   * aprenderlo una vez.
   */
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon: Icon, title, hint, count, id, action, children }) => (
  <Card id={id} className="scroll-mt-20 space-y-3">
    <div className="flex items-start gap-2.5">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950/50 dark:text-primary-300">
        <Icon className="h-4 w-4" aria-hidden strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <CardTitle>{title}</CardTitle>
          {count !== undefined && count > 0 && (
            <Badge tone="gray" size="xs">{count}</Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      </div>
      {action}
    </div>
    {children}
  </Card>
);

export const EmptyRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
    {children}
  </p>
);

export const RemoveButton: React.FC<{ label: string; onClick: () => void; disabled?: boolean }> = ({
  label, onClick, disabled,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-40 dark:hover:bg-red-950/40 dark:hover:text-red-400"
  >
    <Trash2 className="h-3.5 w-3.5" aria-hidden />
  </button>
);
