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
import { Boxes, Landmark, LayoutDashboard, Network, PackageCheck, Shield, Users } from 'lucide-react';
import { AcademicCapIcon, Cog6ToothIcon } from '../Icons';
import type { Permission } from '../../lib/authz';

export type RailGroup = 'entry' | 'hierarchy' | 'system';

export interface RailItem {
    id: string;
    /** Los textos del destino viven en el diccionario: `rail.<id>.label|long|hint`. */
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
    { id: 'dashboard', icon: <LayoutDashboard className="h-5 w-5" />, href: '/', match: (p) => p === '/', group: 'entry' },
    { id: 'initiatives', icon: <Landmark className="h-5 w-5" />, href: '/initiatives', match: (p) => p.startsWith('/initiatives'), group: 'hierarchy' },
    { id: 'projects', icon: <Boxes className="h-5 w-5" />, href: '/projects', match: (p) => p.startsWith('/projects') || p.startsWith('/workspace') || p.startsWith('/sdd-process'), group: 'hierarchy' },
    { id: 'deliverables', icon: <PackageCheck className="h-5 w-5" />, href: '/office', match: (p) => p.startsWith('/office'), group: 'hierarchy', primary: true },
    // Los agentes son el reparto que atiende cualquier solicitud, así que su
    // ficha es una pantalla de sistema como Formación o Ajustes: se llega desde
    // el raíl y desde ningún otro sitio.
    { id: 'agents', icon: <Users className="h-5 w-5" />, href: '/agents', match: (p) => p.startsWith('/agents'), group: 'system' },
    { id: 'capabilities', icon: <Network className="h-5 w-5" />, href: '/capabilities', match: (p) => p.startsWith('/capabilities'), group: 'system' },
    { id: 'training', icon: <AcademicCapIcon className="h-5 w-5" />, href: '/training', match: (p) => p.startsWith('/training'), group: 'system' },
    // «Configuración» es un carácter más ancho de lo que cabe y trunca a
    // «Configurac…». El registro corto existe justo para esto: el botón dice
    // Ajustes, el tooltip y el nombre accesible dicen Configuración.
    { id: 'settings', icon: <Cog6ToothIcon className="h-5 w-5" />, href: '/settings', match: (p) => p.startsWith('/settings'), group: 'system' },
    { id: 'security', icon: <Shield className="h-5 w-5" />, href: '/users', match: (p) => p.startsWith('/users'), group: 'system', permission: 'users:read' },
];

/**
 * La clave del rótulo de cada grupo, visible sólo cuando el raíl está desplegado.
 *
 * `entry` no tiene: el Dashboard es uno solo, y un rótulo sobre un único
 * elemento es una categoría inventada para justificar la línea que la separa.
 */
export const RAIL_GROUP_LABEL_KEYS: Readonly<Record<RailGroup, string | null>> = Object.freeze({
    entry: null,
    hierarchy: 'rail.group.work',
    system: 'rail.group.system',
});

/** Los tres textos de un destino, traducidos. El corto se ve plegado; el largo es el nombre accesible. */
export const railItemText = (id: string, t: (key: string) => string) => ({
    label: t(`rail.${id}.label`),
    longLabel: t(`rail.${id}.long`),
    hint: t(`rail.${id}.hint`),
});
