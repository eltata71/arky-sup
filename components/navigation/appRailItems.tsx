/**
 * El catálogo de destinos del raíl: qué hay, en qué orden y qué permiso exige.
 *
 * Vive fuera de `AppRail.tsx` porque son dos cosas distintas: esto es la
 * arquitectura de información del producto —la lista que hay que leer para
 * saber de qué se compone— y aquélla es el comportamiento de un componente que
 * se pliega, se fija y anima un indicador. Juntas pasaban de los 20 KB que
 * `check:module-size` permite a un módulo, y el corte por el que pedía el gate
 * era justamente éste.
 */

import React from 'react';
import { Boxes, Landmark, LayoutDashboard, PackageCheck, Shield, Users } from 'lucide-react';
import { AcademicCapIcon, Cog6ToothIcon } from '../Icons';
import type { Permission } from '../../lib/authz';
import { EA_LEVELS } from '../../lib/eaTerminology';

export type RailGroup = 'entry' | 'hierarchy' | 'system';

export interface RailItem {
    id: string;
    /**
     * El registro corto — lo que se ve bajo el glifo cuando el raíl está
     * plegado, donde el sitio escasea y el icono ya lleva la mayor parte del
     * significado. La pantalla que abre muestra el nombre largo en su título;
     * ver `EaLevelTerms`.
     */
    label: string;
    /**
     * Nombre largo. Es el nombre accesible del botón en los dos estados, y el
     * texto visible cuando el raíl está desplegado. Que no cambie al abrir es
     * lo que hace que abrir el raíl altere lo que se ve y nunca lo que se
     * anuncia.
     */
    longLabel: string;
    /** Para qué sirve el destino. Segunda línea del tooltip y del panel abierto. */
    hint?: string;
    icon: React.ReactNode;
    href: string;
    match: (path: string) => boolean;
    /** Los que comparten grupo van juntos, separados por una línea o un rótulo. */
    group: RailGroup;
    /** La puerta de entrada del producto, con un tinte que lo dice. */
    primary?: boolean;
    /**
     * El permiso que exige el destino, cuando exige uno.
     *
     * Nombrado por el acto y no por el rol: el raíl no debe enterarse de que
     * existe un rol llamado `admin`, y `firestore.rules` concede el mismo
     * permiso desde la misma matriz.
     */
    permission?: Permission;
}

/**
 * El raíl es toda la navegación del producto, leído de arriba abajo en el orden
 * en que se enseña la jerarquía:
 *
 *   Dashboard        donde abre el sistema: el portafolio de un vistazo
 *   ── el trabajo ──
 *   Iniciativas      la necesidad del negocio
 *   Proyectos        la respuesta de arquitectura
 *   Entregables      las unidades gobernadas que produce la Oficina
 *   ── el sistema ──
 *   Agentes
 *   Formación
 *   Configuración
 *   Seguridad        (sólo administradores)
 *
 * Cada elemento lleva los dos registros: el corto es lo que se ve plegado, el
 * largo es lo que dicen el tooltip, el panel abierto y el lector de pantalla.
 * Ésa es la razón entera de que `EaLevelTerms` tenga dos — un raíl que dijera
 * «Solicitudes de Entregables» se parte en tres líneas, y una página titulada
 * «Entregables» se lee como una abreviatura.
 *
 * Agentes, Formación, Configuración y Seguridad viven **aquí y en ningún otro
 * sitio**: son asuntos del sistema, y repetirlos dentro de las pantallas de
 * trabajo es lo que hacía que la vieja portada compitiera con el raíl.
 */
export const RAIL_ITEMS: RailItem[] = [
    { id: 'dashboard', label: 'Dashboard', longLabel: 'Centro de mando', hint: 'Todo el portafolio de un vistazo', icon: <LayoutDashboard className="h-5 w-5" />, href: '/', match: (p) => p === '/', group: 'entry' },
    { id: 'initiatives', label: EA_LEVELS.initiative.shortPlural, longLabel: EA_LEVELS.initiative.plural, hint: 'La necesidad del negocio', icon: <Landmark className="h-5 w-5" />, href: '/initiatives', match: (p) => p.startsWith('/initiatives'), group: 'hierarchy' },
    { id: 'projects', label: EA_LEVELS.engagementProject.shortPlural, longLabel: EA_LEVELS.engagementProject.plural, hint: 'La respuesta de arquitectura', icon: <Boxes className="h-5 w-5" />, href: '/projects', match: (p) => p.startsWith('/projects') || p.startsWith('/workspace') || p.startsWith('/sdd-process'), group: 'hierarchy' },
    { id: 'deliverables', label: EA_LEVELS.deliverable.shortPlural, longLabel: EA_LEVELS.deliverable.plural, hint: 'El trabajo gobernado de la Oficina', icon: <PackageCheck className="h-5 w-5" />, href: '/office', match: (p) => p.startsWith('/office'), group: 'hierarchy', primary: true },
    // Los agentes son el reparto que atiende cualquier solicitud, así que su
    // ficha es una pantalla de sistema como Formación o Ajustes: se llega desde
    // el raíl y desde ningún otro sitio.
    { id: 'agents', label: 'Agentes', longLabel: 'Agentes de la Oficina', hint: 'Habilidades, conocimiento, memoria y modelo de cada agente', icon: <Users className="h-5 w-5" />, href: '/agents', match: (p) => p.startsWith('/agents'), group: 'system' },
    { id: 'training', label: 'Formación', longLabel: 'Centro de Formación', hint: 'Cursos y laboratorios', icon: <AcademicCapIcon className="h-5 w-5" />, href: '/training', match: (p) => p.startsWith('/training'), group: 'system' },
    // «Configuración» es un carácter más ancho de lo que cabe y trunca a
    // «Configurac…». El registro corto existe justo para esto: el botón dice
    // Ajustes, el tooltip y el nombre accesible dicen Configuración.
    { id: 'settings', label: 'Ajustes', longLabel: 'Configuración', hint: 'Tema, idioma, modelo de IA y claves', icon: <Cog6ToothIcon className="h-5 w-5" />, href: '/settings', match: (p) => p.startsWith('/settings'), group: 'system' },
    { id: 'security', label: 'Seguridad', longLabel: 'Seguridad', hint: 'Usuarios, roles y permisos', icon: <Shield className="h-5 w-5" />, href: '/users', match: (p) => p.startsWith('/users'), group: 'system', permission: 'users:read' },
];

/**
 * El rótulo de cada grupo, visible sólo cuando el raíl está desplegado.
 *
 * `entry` no tiene: el Dashboard es uno solo, y un rótulo sobre un único
 * elemento es una categoría inventada para justificar la línea que la separa.
 */
export const RAIL_GROUP_LABELS: Readonly<Record<RailGroup, string | null>> = Object.freeze({
    entry: null,
    hierarchy: 'El trabajo',
    system: 'El sistema',
});
