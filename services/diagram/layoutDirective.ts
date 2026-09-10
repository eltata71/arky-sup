/**
 * Archetype-aware layout directives.
 *
 * The general `inferDirection` heuristic in `lib/layoutEngine.ts` is good for
 * the average C4 diagram but it makes bad calls for process / value-stream /
 * sequence diagrams: a vertical process strip on a wide iPad viewport leaves
 * 70% of the canvas empty.
 *
 * This module maps the detected `DiagramArchetype` to a concrete layout
 * directive (direction + density + node-spacing hint). The canvas component
 * applies the directive on first paint and on archetype changes.
 *
 * Designed to be additive: when the archetype is `generic`, the directive
 * keeps `direction: 'auto'` so the legacy `inferDirection` heuristic stays
 * in charge — no surprise re-layouts for existing diagrams.
 *
 * Pure module — no React / DOM dependencies, fully unit-testable.
 */

import type { DiagramIR } from '../../lib/diagram';
import {
    detectDiagramArchetype,
    type DiagramArchetype,
} from './diagramTypeQualityGates';

export type LayoutDirection = 'TB' | 'LR';
export type LayoutDensityHint = 'compact' | 'normal' | 'spacious';

export interface LayoutDirective {
    /**
     * Preferred layout direction. `null` means "let the engine decide" so the
     * legacy `inferDirection` heuristic keeps working for unknown archetypes.
     */
    direction: LayoutDirection | null;
    density: LayoutDensityHint;
    /**
     * Human-readable reason — surfaced in telemetry and tooltips ("Aplicado
     * layout horizontal: arquetipo Value Stream"). Empty when no directive
     * is asserted.
     */
    rationale: string;
    archetype: DiagramArchetype;
}

const DEFAULT_DIRECTIVE: LayoutDirective = {
    direction: null,
    density: 'normal',
    rationale: '',
    archetype: 'generic',
};

/**
 * Map a value-stream / process / integration title (in Spanish or English)
 * to a layout directive. Title-based detection wins over archetype
 * detection because the title carries the strongest user intent.
 */
const VALUE_STREAM_RE = /\b(value\s*stream|mapa\s+de\s+flujo\s+de\s+valor|vsm)\b/i;
const PROCESS_RE = /\b(bpmn|proceso|process|workflow|flujo\s+de\s+negocio|customer\s+journey|journey\s+map)\b/i;
const SEQUENCE_RE = /\b(secuencia|sequence)\b/i;
const DATA_FLOW_RE = /\b(data\s*flow|flujo\s+de\s+datos|dfd|pipeline|etl)\b/i;
const INTEGRATION_RE = /\b(integraci|integration|esb|ipaas)\b/i;
const DEPLOYMENT_RE = /\b(despliegue|deployment|infraestructura|topolog[íi]a)\b/i;

/**
 * Compute the canonical layout directive for an IR.
 *
 * Public entry point — call this once after the IR has been repaired but
 * before passing it to `layoutIR` so the directive lands in the same dagre
 * pass that positions the nodes.
 */
export function selectLayoutDirective(ir: DiagramIR): LayoutDirective {
    const archetype = detectDiagramArchetype(ir);
    const title = (ir.metadata?.title ?? '').toLowerCase();
    const nodeCount = ir.nodes.length;

    // Title-based rules first — strongest signal.
    if (VALUE_STREAM_RE.test(title)) {
        return {
            archetype,
            direction: 'LR',
            density: 'normal',
            rationale: 'Value Stream: orientación horizontal por convención (etapas izquierda → derecha).',
        };
    }
    if (PROCESS_RE.test(title)) {
        // BPMN reads left→right when there are lanes (the lanes stack
        // vertically). When there are no lanes and the process is short,
        // vertical still works.
        const hasLanes = ir.groups.length >= 2;
        return {
            archetype,
            direction: hasLanes ? 'LR' : 'TB',
            density: 'normal',
            rationale: hasLanes
                ? 'BPMN con carriles: horizontal para que cada lane sea una fila legible.'
                : 'BPMN sin carriles: vertical para que el flujo se lea de inicio a fin.',
        };
    }
    if (SEQUENCE_RE.test(title)) {
        return {
            archetype,
            direction: 'LR',
            density: 'normal',
            rationale: 'Diagrama de secuencia: horizontal para mantener la línea temporal.',
        };
    }
    if (DATA_FLOW_RE.test(title)) {
        return {
            archetype,
            direction: 'LR',
            density: nodeCount > 18 ? 'compact' : 'normal',
            rationale: 'Flujo de datos: horizontal — fuente → transformaciones → destino.',
        };
    }
    if (INTEGRATION_RE.test(title)) {
        // Integration diagrams have many cross-cutting connections; vertical
        // layered layout produces fewer crossings.
        return {
            archetype,
            direction: 'TB',
            density: nodeCount > 18 ? 'compact' : 'normal',
            rationale: 'Diagrama de integración: vertical en capas (canales / integración / dominio / datos).',
        };
    }
    if (DEPLOYMENT_RE.test(title)) {
        return {
            archetype,
            direction: 'TB',
            density: nodeCount > 12 ? 'compact' : 'normal',
            rationale: 'Deployment: vertical para mostrar capas físicas (cloud → nodo → contenedor).',
        };
    }

    // Archetype-based fallbacks when the title isn't explicit.
    switch (archetype) {
        case 'process':
            return {
                archetype,
                direction: ir.groups.length >= 2 ? 'LR' : 'TB',
                density: 'normal',
                rationale: ir.groups.length >= 2
                    ? 'Proceso con lanes: horizontal para alinear cada lane como una fila.'
                    : 'Proceso lineal: vertical para que el flujo se lea de inicio a fin.',
            };
        case 'integration':
            return {
                archetype,
                direction: 'TB',
                density: nodeCount > 18 ? 'compact' : 'normal',
                rationale: 'Integración detectada por semántica: vertical en capas.',
            };
        case 'sequence':
            return {
                archetype,
                direction: 'LR',
                density: 'normal',
                rationale: 'Secuencia detectada por semántica: horizontal.',
            };
        case 'data':
            return {
                archetype,
                direction: 'LR',
                density: nodeCount > 18 ? 'compact' : 'normal',
                rationale: 'Diagrama de datos: horizontal — fuentes → almacenes → consumidores.',
            };
        case 'context':
            // Context diagrams are usually small (≤ 10 nodes); horizontal
            // looks more balanced when the system has 2-3 actors on the
            // sides.
            return {
                archetype,
                direction: nodeCount <= 8 ? 'LR' : 'TB',
                density: 'spacious',
                rationale: 'Contexto C4: orientación balanceada y densidad amplia para foco ejecutivo.',
            };
        case 'container':
            return {
                archetype,
                direction: nodeCount > 14 ? 'TB' : 'LR',
                density: nodeCount > 18 ? 'compact' : 'normal',
                rationale: 'Contenedores C4: vertical en capas cuando hay muchos contenedores; horizontal cuando son pocos.',
            };
        case 'component':
            return {
                archetype,
                direction: nodeCount > 10 ? 'TB' : 'LR',
                density: 'normal',
                rationale: 'Componentes C4: horizontal para diagramas pequeños; vertical cuando crecen.',
            };
        case 'deployment':
            return {
                archetype,
                direction: 'TB',
                density: nodeCount > 12 ? 'compact' : 'normal',
                rationale: 'Deployment detectado por semántica: vertical en capas físicas.',
            };
        case 'generic':
        default:
            return { ...DEFAULT_DIRECTIVE, archetype };
    }
}
