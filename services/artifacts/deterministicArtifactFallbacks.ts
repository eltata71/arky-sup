/**
 * The deterministic artifact fallbacks — what the product renders when the
 * model cannot.
 *
 * These 400-odd lines lived inside `services/geminiService.ts` and reached the
 * rest of the app through the `services/ai` barrel, so the provider-agnostic
 * layer's public API re-exported four functions out of the legacy engine.
 *
 * They never belonged there. Not one of them calls a model: they are pure
 * functions from a `Project` and an `ArtifactTemplate` to Mermaid or Markdown,
 * and their whole purpose is to produce something honest and editable *when*
 * generation failed. Their only consumer is `artifactGenerationFallbacks.ts`,
 * in this same folder.
 *
 * The marker they stamp is the one `artifactFallbackDetection.ts` owns, which
 * is what lets the canvas show the "Esqueleto base — edítame" badge without
 * having to ask who produced the content.
 */

import type { ArtifactTemplate, Project } from '../../types';
import {
    DETERMINISTIC_DOCUMENT_FALLBACK_MARKER,
    SKELETON_FALLBACK_MARKER,
} from './artifactFallbackDetection';
// Naming the file, not the module's barrel — both of these are on the eager
// path. Entering `services/diagram` through its `index.ts` here drags the whole
// diagram module (mermaid, ELK, the quality gates) into the entry chunk: 660 KB
// gz became 1.098 KB and `check:bundle-budget` refused it. Doing the same from
// `geminiService` through the `services/artifacts` barrel cost 1.126 KB.
//
// Third and fourth time this trade-off has come up, and the rule has not
// changed: a barrel is the right door from lazy code; from code the entry chunk
// reaches, you name the file. The bundle budget is what tells the two apart.
import { extractDiagramSignals } from '../diagram/diagramSignalExtractor';
import { safeMermaidLabel } from './deterministicMermaidLabels';
import {
    buildBusinessProcessHybridFallback,
    buildLogicalDataFlowHybridFallback,
} from './deterministicHybridFallbacks';

/**
 * Build a richer flowchart body from deterministically extracted project
 * signals. Used as the default skeleton case when AI generation fails AND
 * the project has enough context to produce something more useful than the
 * generic 3-box placeholder.
 *
 * Strategy:
 *  - Pulls actors, systems, integrations, dataStores and messaging out of
 *    `extractDiagramSignals` (deterministic, regex-based).
 *  - Lays them in a left-to-right flow with semantic grouping.
 *  - Falls back to the generic shape only when the project is genuinely
 *    contextless.
 */
function buildSignalDrivenSkeleton(project: Project, template: ArtifactTemplate, systemName: string, objective: string): string | null {
    const signals = extractDiagramSignals(project);
    const actors = signals.actors.slice(0, 3).map(s => safeMermaidLabel(s.label, 'Actor'));
    const systems = signals.systems.slice(0, 4).map(s => safeMermaidLabel(s.label, 'Sistema'));
    const integrations = signals.integrations.slice(0, 4).map(s => safeMermaidLabel(s.label, 'Integración'));
    const data = signals.dataStores.slice(0, 3).map(s => safeMermaidLabel(s.label, 'Datos'));
    const messaging = signals.messaging.slice(0, 2).map(s => safeMermaidLabel(s.label, 'Cola'));

    const totalSignals = actors.length + systems.length + integrations.length + data.length + messaging.length;
    if (totalSignals < 3) return null;

    const lines: string[] = ['flowchart LR'];
    lines.push('    classDef actor fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#1e3a8a');
    lines.push('    classDef sys fill:#e0e7ff,stroke:#4f46e5,stroke-width:2px,color:#1e1b4b');
    lines.push('    classDef intg fill:#ede9fe,stroke:#7c3aed,stroke-width:2px,color:#2e1065');
    lines.push('    classDef data fill:#d1fae5,stroke:#059669,stroke-width:2px,color:#064e3b');
    lines.push('    classDef msg fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#451a03');

    const ids = { actors: [] as string[], systems: [] as string[], integrations: [] as string[], data: [] as string[], messaging: [] as string[] };
    if (actors.length) {
        lines.push(`    subgraph zone_actors ["Actores"]`);
        actors.forEach((label, idx) => {
            const id = `actor_${idx + 1}`;
            ids.actors.push(id);
            lines.push(`        ${id}(("${label}")):::actor`);
        });
        lines.push('    end');
    }
    const coreSystem = `core_system`;
    lines.push(`    subgraph zone_core ["${systemName}"]`);
    lines.push(`        ${coreSystem}["${systemName}<br/>${objective}"]:::sys`);
    systems.forEach((label, idx) => {
        const id = `sys_${idx + 1}`;
        ids.systems.push(id);
        lines.push(`        ${id}["${label}"]:::sys`);
    });
    lines.push('    end');
    if (integrations.length) {
        lines.push(`    subgraph zone_int ["Integraciones"]`);
        integrations.forEach((label, idx) => {
            const id = `intg_${idx + 1}`;
            ids.integrations.push(id);
            lines.push(`        ${id}["${label}"]:::intg`);
        });
        lines.push('    end');
    }
    if (data.length) {
        lines.push(`    subgraph zone_data ["Datos"]`);
        data.forEach((label, idx) => {
            const id = `data_${idx + 1}`;
            ids.data.push(id);
            lines.push(`        ${id}[("${label}")]:::data`);
        });
        lines.push('    end');
    }
    if (messaging.length) {
        lines.push(`    subgraph zone_msg ["Mensajería / Eventos"]`);
        messaging.forEach((label, idx) => {
            const id = `msg_${idx + 1}`;
            ids.messaging.push(id);
            lines.push(`        ${id}>"${label}"]:::msg`);
        });
        lines.push('    end');
    }
    // Wire the flow so the diagram is connected (no orphan nodes).
    ids.actors.forEach(actorId => lines.push(`    ${actorId} -->|"Usa"| ${coreSystem}`));
    ids.systems.forEach(sysId => lines.push(`    ${coreSystem} -->|"Coordina"| ${sysId}`));
    ids.integrations.forEach(intId => lines.push(`    ${coreSystem} -->|"Integra"| ${intId}`));
    ids.data.forEach(dataId => lines.push(`    ${coreSystem} -->|"Lee/escribe"| ${dataId}`));
    ids.messaging.forEach(msgId => lines.push(`    ${coreSystem} -->|"Publica"| ${msgId}`));

    if (template.type === 'mermaid-c4-context' || template.type === 'mermaid-c4-container' || template.type.startsWith('mermaid-c4-')) {
        // C4 dialect can't be expressed in flowchart syntax exactly, but
        // rendering this richer flowchart is still better than the 3-box
        // placeholder. The downstream renderer accepts both.
        return lines.join('\n');
    }
    return lines.join('\n');
}

/** Returns true when an artifact's raw Mermaid content was emitted by the
 *  deterministic skeleton fallback (used by the canvas to surface the
 *  "Esqueleto base — edítame" badge regardless of whether the IR carries
 *  metadata.fallback). */
export function isSkeletonFallbackContent(content: string | undefined | null): boolean {
    if (!content) return false;
    return content.includes(SKELETON_FALLBACK_MARKER);
}

/**
 * Tags Mermaid emitted from a fallback IR with the same deterministic-skeleton
 * marker used by `buildDeterministicDiagramSkeleton`. This is needed for the
 * C4 self-healing path: it falls back at the IR layer, serializes through
 * `irToMermaid`, and would otherwise lose the observable fallback marker.
 */
export function markMermaidAsSkeletonFallback(content: string): string {
    if (!content || isSkeletonFallbackContent(content)) return content;
    const newlineIdx = content.indexOf('\n');
    if (newlineIdx === -1) {
        return `${content}\n${SKELETON_FALLBACK_MARKER}`;
    }
    return `${content.slice(0, newlineIdx + 1)}${SKELETON_FALLBACK_MARKER}\n${content.slice(newlineIdx + 1)}`;
}

/**
 * Public entry point — guarantees every deterministic skeleton body is
 * tagged with the marker so the canvas can render the degraded-state badge
 * even when the content travels as raw Mermaid (no IR metadata in flight).
 *
 * The marker is inserted as a Mermaid `%%` comment on the line *after* the
 * dialect declaration so the first line keeps matching `/^C4Deployment/`,
 * `/^flowchart/`, etc. — preserving compatibility with parser tests and
 * downstream renderers that sniff the dialect from line 1.
 */
export function buildDeterministicDiagramSkeleton(project: Project, template: ArtifactTemplate): string {
    const body = buildDeterministicDiagramSkeletonBody(project, template);
    if (template.type === 'react-flow-graph') {
        // ReactFlow JSON has no comment syntax. We bypass the marker — the
        // renderer's placeholder logic still kicks in via empty-flow checks.
        return body;
    }
    if (template.type === 'hybrid-text-diagram') {
        // Hybrid bodies are full Markdown — inject the marker AFTER the
        // first Mermaid header line inside the fence.
        return body.replace(
            /(```mermaid\s*\n[^\n]+\n)/i,
            (match) => `${match}${SKELETON_FALLBACK_MARKER}\n`,
        );
    }
    // Pure Mermaid bodies: the first line is the dialect header. Insert the
    // marker on line 2 so dialect sniffing (`/^C4Deployment/`, etc.) still
    // works and regex-based audits keep passing.
    return markMermaidAsSkeletonFallback(body);
}

/**
 * Last-resort diagram body. Used when every AI attempt (primary + reinforced
 * + flowchart fallback) produced zero parseable nodes — without this, the
 * canvas would stay blank and the user would be stuck repeatedly clicking
 * "Reintentar". The skeleton is intentionally minimal but always produces
 * ≥ 2 nodes and ≥ 1 edge so the deterministic parser, audience projector
 * and ReactFlow renderer all have something to chew on.
 *
 * When the project has enough extracted signals (actors / systems /
 * integrations / data / messaging) we build a richer flowchart skeleton via
 * `buildSignalDrivenSkeleton` so the user sees something useful even when
 * Gemini failed. This addresses the "empty canvas" UX bug where the
 * fallback was a meaningless 3-box default.
 */

function buildDeterministicDiagramSkeletonBody(project: Project, template: ArtifactTemplate): string {
    const systemName = safeMermaidLabel(project?.name, 'Sistema');
    const description = safeMermaidLabel(project?.description, template.objective ?? 'Sistema en construcción');
    const objective = safeMermaidLabel(template.objective, 'Recorrido principal');
    const originalRequest = safeMermaidLabel(template.requestContext?.userRequest, objective);
    const hybridName = (template.name ?? '').toLowerCase();
    const hybridRequest = (template.requestContext?.userRequest ?? template.objective ?? '').toLowerCase();
    const isLogicalDataFlowRequest = /flujo\s+de\s+datos|data\s+flow|dfd|logical\s+data|datos\s+l[oó]gico/.test(hybridName)
        || /flujo\s+de\s+datos|data\s+flow|dfd|datos\s+l[oó]gico/.test(hybridRequest);
    if (isLogicalDataFlowRequest) {
        const dfd = buildLogicalDataFlowHybridFallback(project, template);
        if (template.type === 'hybrid-text-diagram') return dfd;
        const mermaidMatch = dfd.match(/```mermaid\s*([\s\S]*?)```/i);
        if (template.type.startsWith('mermaid') && mermaidMatch?.[1]) return mermaidMatch[1].trim();
    }

    if (
        template.type === 'hybrid-text-diagram' &&
        (/bpmn|proceso\s+de\s+negocio|business\s+process/.test(hybridName) || /proceso|flujo|reclamo|farmacia|receta|pago|asegur/.test(hybridRequest))
    ) {
        return buildBusinessProcessHybridFallback(project, template);
    }

    // For non-C4 diagrams, prefer the signal-driven skeleton when project
    // context is rich enough. C4 dialects keep their hand-tuned templates so
    // round-tripping through mermaidToIR continues to work.
    const isC4 = template.type.startsWith('mermaid-c4-');
    if (!isC4) {
        const enriched = buildSignalDrivenSkeleton(project, template, systemName, objective);
        if (enriched) {
            if (template.type === 'hybrid-text-diagram') {
                return `## ${template.name}\n\n> Versión local enriquecida automáticamente con las señales del proyecto (actores, sistemas, integraciones, datos, mensajería). Regenera con IA para profundizar en cada nodo.\n\n## Solicitud original\n${originalRequest}\n\n\`\`\`mermaid\n${enriched}\n\`\`\``;
            }
            return enriched;
        }
    }

    switch (template.type) {
        case 'mermaid-c4-context':
            return `C4Context
    title System Context — ${systemName}
    Person(user, "Usuario", "${description}")
    System(system, "${systemName}", "${objective}")
    Rel(user, system, "Usa", "Web/HTTPS")`;

        case 'mermaid-c4-container':
            return `C4Container
    title Container Diagram — ${systemName}
    Person(user, "Usuario", "${description}")
    System_Boundary(sb, "${systemName}") {
        Container(web, "Web App", "React/TypeScript", "${objective}")
        ContainerDb(db, "Base de Datos", "PostgreSQL", "Persistencia principal")
    }
    Rel(user, web, "Usa", "HTTPS")
    Rel(web, db, "Lee/escribe", "SQL")`;

        case 'mermaid-c4-component':
            return `C4Component
    title Component Diagram — ${systemName}
    Container_Boundary(api, "${systemName} API") {
        Component(ctrl, "Controller", "Rest", "${objective}")
        Component(svc, "Service", "Domain", "Lógica de negocio")
        ComponentDb(repo, "Repository", "JPA", "Acceso a datos")
    }
    Rel(ctrl, svc, "Invoca")
    Rel(svc, repo, "Lee/escribe")`;

        case 'mermaid-c4-deployment':
            return `C4Deployment
    title Deployment Diagram — ${systemName}
    Deployment_Node(cloud, "Cloud Provider", "Producción") {
        Deployment_Node(cluster, "Kubernetes", "v1.29") {
            Container(web, "${systemName}", "Container", "${objective}")
        }
        ContainerDb(db, "Base de Datos", "Managed PostgreSQL", "Persistencia")
    }
    Rel(web, db, "TCP/5432")`;

        case 'hybrid-text-diagram': {
            const tname = (template.name ?? '').toLowerCase();
            const isVSM = /flujo\s+de\s+valor|value\s+stream|vsm/.test(tname);
            const isBPMN = /bpmn|proceso\s+de\s+negocio|business\s+process/.test(tname);
            if (isVSM) {
                return `## ${template.name}\n\nFlujo de valor end-to-end para ${systemName}.\n\n\`\`\`mermaid\nflowchart LR\n    classDef warning fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#7c2d12\n    subgraph Cliente_zone ["Cliente"]\n        cliente(("Cliente"))\n    end\n    subgraph Operacion ["Operación"]\n        solicita["Solicita pedido<br/>LT 1d"]\n        prepara["Prepara orden<br/>PT 6h"]\n        produce["Produce<br/>PT 2d"]\n        controla{"Control de calidad"}\n        empaca["Empaca<br/>PT 4h"]\n    end\n    subgraph Logistica ["Logística"]\n        despacha["Despacha"]\n        entrega["Entrega"]\n    end\n    cliente -->|Solicita| solicita\n    solicita -->|Aprueba| prepara\n    prepara -->|Wait 1d| produce\n    produce -->|Inspecciona| controla\n    controla -->|OK| empaca\n    controla -->|Reproceso| produce\n    empaca -->|Wait 12h| despacha\n    despacha -->|LT 2d| entrega\n    entrega -->|Feedback| cliente\n    class controla warning\n\`\`\`\n\nReemplaza los pasos por los del proceso real, manteniendo la estructura de subgrupos (actor/dominio) y las métricas LT/PT/Wait.`;
            }
            if (isBPMN) {
                return buildBusinessProcessHybridFallback(project, template);
            }
            return buildBusinessProcessHybridFallback(project, template);
        }

        default:
            return `flowchart TD
    user["Usuario"]
    system["${systemName}"]
    objective["${objective}"]
    user --> system
    system --> objective`;
    }
}

export function buildDeterministicArtifactFallback(project: Project, template: ArtifactTemplate): string {
    const projectName = project.name || 'Proyecto';
    const contextItems = (project.projectContext ?? []).slice(0, 6);
    const inventory = (project.artifacts ?? [])
        .slice()
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
        .slice(0, 6)
        .map(artifact => `- ${artifact.name} (${artifact.type}) — ${artifact.objective}`)
        .join('\n');

    if (template.type === 'yaml') {
        return `artifact: ${JSON.stringify(template.name)}\nproject: ${JSON.stringify(projectName)}\nobjective: ${JSON.stringify(template.objective)}\nstatus: "fallback-local"\ncontext:\n${contextItems.map(item => `  - ${JSON.stringify(item)}`).join('\n') || '  - "Sin contexto adicional registrado"'}\nnext_steps:\n  - "Validar el contenido con el arquitecto responsable"\n  - "Regenerar con IA cuando el servicio esté disponible"\n`;
    }

    if (template.type === 'react-flow-graph') {
        return JSON.stringify({
            nodes: [
                { id: 'project', type: 'custom', position: { x: 0, y: 0 }, data: { label: projectName, type: 'System', description: template.objective } },
                { id: 'context', type: 'custom', position: { x: 280, y: 0 }, data: { label: 'Contexto priorizado', type: 'Document', description: contextItems[0] ?? 'Contexto pendiente de completar.' } },
                { id: 'outcome', type: 'custom', position: { x: 560, y: 0 }, data: { label: template.name, type: 'Artifact', description: 'Artefacto local compatible generado por contingencia.' } },
            ],
            edges: [
                { id: 'e-project-context', source: 'project', target: 'context', label: 'prioriza' },
                { id: 'e-context-outcome', source: 'context', target: 'outcome', label: 'estructura' },
            ],
        }, null, 2);
    }

    if (template.type.startsWith('mermaid') || template.type === 'hybrid-text-diagram') {
        return buildDeterministicDiagramSkeleton(project, template);
    }

    return `${DETERMINISTIC_DOCUMENT_FALLBACK_MARKER}\n# ${template.name}\n\n> Contenido local de respaldo generado porque el servicio de IA no respondió de forma confiable. El artefacto queda editable y compatible para no interrumpir el flujo de trabajo.\n\n## Objetivo\n${template.objective}\n\n## Proyecto\n- **Nombre:** ${projectName}\n- **Descripción:** ${project.description || 'Sin descripción registrada.'}\n- **Vista arquitectónica:** ${template.architecturalView}\n- **Fase:** ${template.phase}\n\n## Contexto priorizado\n${contextItems.length > 0 ? contextItems.map(item => `- ${item}`).join('\n') : '- Sin contexto adicional registrado.'}\n\n## Inventario usado como señal\n${inventory || '- Sin artefactos previos registrados.'}\n\n## Plan de elaboración\n1. Validar con el arquitecto los supuestos y el nivel de detalle esperado.\n2. Completar el contenido usando el contexto real del proyecto y los artefactos existentes.\n3. Regenerar o refinar con IA cuando Gemini esté disponible para enriquecer el detalle.\n`;
}
