/**
 * The two hybrid fallbacks: Markdown around a Mermaid diagram.
 *
 * Split from `deterministicArtifactFallbacks.ts` because they are a capability
 * of their own — a business process and a logical data flow, each rendered as a
 * narrative document with a diagram inside — and together they were two thirds
 * of that file. The entry point stays there; this is what it calls when the
 * template asks for a hybrid.
 */

import type { ArtifactTemplate } from '../../types';
import type { Project } from '../architectureProjects';
import { safeMermaidLabel } from './deterministicMermaidLabels';

export function buildBusinessProcessHybridFallback(project: Project, template: ArtifactTemplate): string {
    const systemName = safeMermaidLabel(project?.name, 'Proyecto');
    const request = safeMermaidLabel(template.requestContext?.userRequest, template.objective ?? 'Proceso solicitado');
    const normalized = `${request} ${template.name} ${template.objective}`.toLowerCase();
    const isPharmacyClaim = /farmacia|receta|reclamo|reclamaci[oó]n|asegur|claim|pharmacy|prescription/.test(normalized);

    const title = template.name;
    const summary = isPharmacyClaim
        ? 'Flujo base de pago de reclamos de farmacia desde la dispensación de la receta hasta la liquidación y recepción del pago por la farmacia.'
        : `Flujo base del proceso solicitado para ${systemName}, con actores, decisiones, validaciones y resultado trazable.`;
    const scope = isPharmacyClaim
        ? 'Incluye dispensación, captura del reclamo, validación de elegibilidad/cobertura, adjudicación, respuesta al punto de venta, conciliación, lote de pago y recepción de fondos. Excluye disputas contractuales avanzadas y auditorías posteriores al pago.'
        : 'Incluye inicio del proceso, validaciones principales, decisión de aceptación/rechazo, ejecución, control y cierre operativo.';
    const actors = isPharmacyClaim
        ? ['Paciente / Afiliado', 'Farmacia', 'Switch / PBM', 'Aseguradora', 'Banco / Pagos']
        : ['Solicitante / Negocio', 'Operación', 'Sistema de soporte', 'Control / Aprobación'];
    const mermaid = isPharmacyClaim
        ? `flowchart LR
    subgraph paciente_lane ["Paciente / Afiliado"]
        inicio(("Inicio"))
        presenta_receta["Presenta receta y credencial"]
    end
    subgraph farmacia_lane ["Farmacia"]
        dispensa_receta["Dispensa medicamento"]
        captura_reclamo["Captura reclamo en POS"]
        recibe_respuesta{"¿Reclamo aprobado?"}
        entrega_medicamento["Entrega medicamento y cobra copago"]
        corrige_reclamo["Corrige datos o solicita aclaración"]
        confirma_pago["Recibe pago y cierra cuenta"]
    end
    subgraph pbm_lane ["Switch / PBM"]
        enruta_reclamo["Enruta reclamo NCPDP"]
        valida_formato["Valida formato y reglas"]
        adjudica_reclamo["Adjudica monto cubierto"]
    end
    subgraph aseguradora_lane ["Aseguradora"]
        valida_cobertura["Valida elegibilidad y cobertura"]
        autoriza_pago{"¿Autoriza pago?"}
        genera_remesa["Genera remesa y explicación de pago"]
    end
    subgraph pagos_lane ["Banco / Pagos"]
        liquida_lote["Liquida lote de pagos"]
        transfiere_fondos["Transfiere fondos a farmacia"]
        fin(("Fin"))
    end
    inicio --> presenta_receta
    presenta_receta --> dispensa_receta
    dispensa_receta --> captura_reclamo
    captura_reclamo --> enruta_reclamo
    enruta_reclamo --> valida_formato
    valida_formato --> valida_cobertura
    valida_cobertura --> adjudica_reclamo
    adjudica_reclamo --> autoriza_pago
    autoriza_pago -->|Sí| recibe_respuesta
    autoriza_pago -->|No| corrige_reclamo
    corrige_reclamo --> captura_reclamo
    recibe_respuesta -->|Aprobado| entrega_medicamento
    recibe_respuesta -->|Rechazado| corrige_reclamo
    entrega_medicamento --> genera_remesa
    genera_remesa --> liquida_lote
    liquida_lote --> transfiere_fondos
    transfiere_fondos --> confirma_pago
    confirma_pago --> fin`
        : `flowchart LR
    subgraph negocio_lane ["Solicitante / Negocio"]
        inicio(("Inicio"))
        solicita["Solicita proceso: ${request}"]
    end
    subgraph operacion_lane ["Operación"]
        registra["Registra caso"]
        valida["Valida información"]
        decision{"¿Cumple reglas?"}
        ejecuta["Ejecuta actividad principal"]
    end
    subgraph sistema_lane ["Sistema de soporte"]
        consulta["Consulta datos y contexto"]
        actualiza["Actualiza estado"]
    end
    subgraph control_lane ["Control / Aprobación"]
        revisa["Revisa resultado"]
        fin(("Fin"))
    end
    inicio --> solicita
    solicita --> registra
    registra --> valida
    valida --> consulta
    consulta --> decision
    decision -->|Sí| ejecuta
    decision -->|No| registra
    ejecuta --> actualiza
    actualiza --> revisa
    revisa --> fin`;

    return `# ${title}

## Resumen
${summary}

## Alcance del proceso
${scope}

## Actores / lanes
${actors.map(actor => `- ${actor}`).join('\n')}

## Diagrama renderizable
\`\`\`mermaid
${mermaid}
\`\`\`

## Notas de lectura y supuestos
- El diagrama usa Mermaid \`flowchart LR\` con subgraphs como lanes para mantener compatibilidad con el parser y ReactFlow.
- Los identificadores son estables y editables; no dependen de valores aleatorios.
- Este contenido es un fallback local determinístico si Gemini falla o devuelve salida no renderizable.
- Solicitud original: ${request}`;
}


export function buildLogicalDataFlowHybridFallback(project: Project, template: ArtifactTemplate): string {
    const systemName = safeMermaidLabel(project?.name, 'Sistema');
    const request = safeMermaidLabel(template.requestContext?.userRequest, template.objective ?? 'Flujo de datos solicitado');
    const normalized = `${request} ${template.name} ${template.objective}`.toLowerCase();
    const isPharmacyClaim = /farmacia|receta|reclamo|reclamaci[oó]n|asegur|claim|pharmacy|prescription|pago/.test(normalized);

    const externalActors = isPharmacyClaim
        ? ['Paciente / Afiliado', 'Farmacia', 'Aseguradora', 'Banco / Pagos']
        : ['Actor externo', 'Sistema origen', 'Sistema destino'];
    const processes = isPharmacyClaim
        ? ['Capturar reclamo', 'Validar elegibilidad', 'Adjudicar cobertura', 'Liquidar pago']
        : ['Capturar datos', 'Validar reglas', 'Transformar información', 'Publicar resultado'];
    const stores = isPharmacyClaim
        ? ['Repositorio de Reclamos', 'Maestro de Afiliados', 'Libro de Pagos']
        : ['Repositorio operacional', 'Catálogo de reglas', 'Histórico/auditoría'];

    const mermaid = isPharmacyClaim
        ? `flowchart LR
    classDef external fill:#f1f5f9,stroke:#64748b,stroke-width:2px,color:#0f172a
    classDef process fill:#e0e7ff,stroke:#4f46e5,stroke-width:2px,color:#1e1b4b
    classDef store fill:#d1fae5,stroke:#059669,stroke-width:2px,color:#064e3b
    classDef boundary fill:#f8fafc,stroke:#94a3b8,stroke-dasharray:6 4,color:#334155

    paciente(("Paciente / Afiliado")):::external
    farmacia(("Farmacia")):::external
    aseguradora(("Aseguradora")):::external
    banco(("Banco / Pagos")):::external

    subgraph boundary_sistema ["Límite lógico: ${systemName}"]
        captura["1. Capturar reclamo NCPDP"]:::process
        valida["2. Validar elegibilidad y cobertura"]:::process
        adjudica["3. Adjudicar monto cubierto"]:::process
        liquida["4. Preparar liquidación de pago"]:::process
        reclamos[("Repositorio de Reclamos")]:::store
        afiliados[("Maestro de Afiliados")]:::store
        pagos[("Libro de Pagos")]:::store
    end

    paciente -->|Datos de receta y credencial| farmacia
    farmacia -->|Reclamo farmacéutico| captura
    captura -->|Reclamo normalizado| reclamos
    captura -->|Consulta elegibilidad| valida
    valida -->|Datos de afiliado y plan| afiliados
    afiliados -->|Cobertura vigente| valida
    valida -->|Reglas y resultado de validación| adjudica
    aseguradora -->|Tabla de cobertura y autorización| adjudica
    adjudica -->|Respuesta aprobada/rechazada| farmacia
    adjudica -->|Monto aprobado| liquida
    liquida -->|Orden de pago| pagos
    pagos -->|Archivo/remesa de pago| banco
    banco -->|Transferencia y confirmación| farmacia`
        : `flowchart LR
    classDef external fill:#f1f5f9,stroke:#64748b,stroke-width:2px,color:#0f172a
    classDef process fill:#e0e7ff,stroke:#4f46e5,stroke-width:2px,color:#1e1b4b
    classDef store fill:#d1fae5,stroke:#059669,stroke-width:2px,color:#064e3b

    origen(("Sistema origen")):::external
    consumidor(("Consumidor / Actor externo")):::external

    subgraph boundary_sistema ["Límite lógico: ${systemName}"]
        captura["1. Capturar datos"]:::process
        valida["2. Validar reglas"]:::process
        transforma["3. Transformar información"]:::process
        publica["4. Publicar resultado"]:::process
        operacional[("Repositorio operacional")]:::store
        reglas[("Catálogo de reglas")]:::store
        auditoria[("Histórico/auditoría")]:::store
    end

    origen -->|Evento o archivo de entrada| captura
    captura -->|Datos normalizados| operacional
    captura -->|Datos a validar| valida
    reglas -->|Reglas de negocio| valida
    valida -->|Datos validados| transforma
    transforma -->|Resultado persistido| auditoria
    transforma -->|Payload de salida| publica
    publica -->|Información consumible| consumidor`;

    return `# ${template.name}

## Propósito
Representar el flujo lógico de datos solicitado para **${systemName}** de forma renderizable, con actores externos, procesos, almacenes de datos y límites del sistema.

## Contrato del DFD lógico
- **Actores externos:** ${externalActors.join(', ')}.
- **Procesos:** ${processes.join(', ')}.
- **Almacenes de datos:** ${stores.join(', ')}.
- **Límite del sistema:** subgraph \`Límite lógico: ${systemName}\`.
- **Sintaxis:** Mermaid \`flowchart LR\` compatible con el parser actual; sin sintaxis experimental.

## Diagrama renderizable
\`\`\`mermaid
${mermaid}
\`\`\`

## Notas de trazabilidad
- Este DFD lógico es un fallback determinístico o una base estable cuando la IA no devuelve un bloque Mermaid válido.
- Cada flecha declara explícitamente el dato que fluye, no sólo la interacción técnica.
- Solicitud original: ${request}`;
}
