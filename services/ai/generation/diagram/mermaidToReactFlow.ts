/**
 * Convert Mermaid source into a ReactFlow graph through a model. Moved out of
 * the engine in F5-01 (corte 6); a failure returns `null`.
 */
import type { Edge, Node } from 'reactflow';
import type { Settings } from '../../../../types';
import { MODEL_TIERS } from '../../../../lib/ai/modelCatalog';
import { cleanJsonString } from '../../../../utils';
import { aiGateway } from '../aiGateway';
import { buildDiagramGenerationConfig } from './diagramGenerationConfig';

/** A ReactFlow graph as the model returns it: two arrays, checked before use. */
export interface ModelFlowGraph {
    nodes: Node[];
    edges: Edge[];
}

const isModelFlowGraph = (value: unknown): value is ModelFlowGraph => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as { nodes?: unknown; edges?: unknown };
    return Array.isArray(candidate.nodes) && Array.isArray(candidate.edges);
};

export async function parseMermaidToReactFlow(
    mermaidSyntax: string,
    settings: Settings
): Promise<ModelFlowGraph | null> {
    const prompt = `Convert this Mermaid syntax to ReactFlow JSON. Mechanical mapping only — preserve every node and edge.

NODES: type='custom', data must include:
- label: display name
- type: specific technology or role keyword (e.g., 'PostgreSQL', 'API Gateway', 'Person', 'Kafka'). Infer from Mermaid node labels and context.
- description: brief 1-2 sentence description inferred from context
- shape (optional): 'cylinder' for databases, 'hexagon' for microservices/functions, 'cloud' for cloud/external, 'person' for actors, 'diamond' for gateways, 'tab-box' for containers
- icon (optional): technology hint for icon (e.g., 'kafka', 'react', 'postgresql')

EDGES: include:
- label: relationship description from Mermaid arrow labels
- edgeType (optional): 'sync' for HTTP/REST, 'async' for events/messages, 'data-flow' for data, 'dependency' for references

Respond ONLY with JSON.

Mermaid:
${mermaidSyntax}`;

    const responseSchema = {
         type: 'object',
         properties: {
             nodes: {
                 type: 'array',
                 items: {
                     type: 'object',
                     properties: {
                         id: {type:'string'},
                         type:{type:'string'},
                         position:{type:'object', properties:{x:{type:'number'},y:{type:'number'}}, required:['x','y']},
                         data: {
                             type:'object',
                             properties: {
                                 label:{type:'string'},
                                 type:{type:'string'},
                                 description:{type:'string'},
                                 shape:{type:'string'},
                                 icon:{type:'string'}
                             },
                             required: ['label', 'type', 'description']
                         }
                     },
                     required: ['id', 'type', 'data', 'position']
                 }
             },
             edges: {
                 type: 'array',
                 items: {
                     type: 'object',
                     properties: {
                         id:{type:'string'},
                         source:{type:'string'},
                         target:{type:'string'},
                         label:{type:'string'},
                         edgeType:{type:'string'}
                     },
                     required: ['id', 'source', 'target']
                 }
             }
         },
         required: ['nodes', 'edges']
    };

    // Mechanical conversion: no creativity needed → flash-lite + thinking
    // OFF cuts the cost ~75% versus the previous flash + implicit-thinking
    // route while keeping the same quality on this bounded task.
    const modelName = MODEL_TIERS.quick;

    try {
        const { text } = await aiGateway.generateContent(settings, modelName, prompt, buildDiagramGenerationConfig({
            temperature: 0.1,
            thinking: 'off',
            responseSchema,
        }));
        const cleanJson = cleanJsonString(text || '');
        const parsed: unknown = JSON.parse(cleanJson || '{"nodes":[], "edges":[]}');
        return isModelFlowGraph(parsed) ? parsed : null;
    } catch (error) {
        console.error("Mermaid Parse Error:", error);
        // Return null so UI handles it gracefully instead of crashing
        return null;
    }
}

/**
 * Generate a complete DiagramIR for an artifact in one shot.
 *
 * This is the **preferred** path for new diagram generation: Gemini emits
 * the canonical IR directly (validated by the SDK against
 * `buildDiagramIRSchema`), and downstream renderers (`irToReactFlow`,
 * `irToMermaid`, `irToExcalidraw`) consume it without any second AI hop.
 *
 * Compared with the legacy "generate Mermaid → parse Mermaid → render"
 * pipeline this:
 *   - eliminates the Mermaid hallucination failure mode (unparseable
 *     dialect, missing closing braces, wrong syntax for the chosen
 *     header) entirely;
 *   - emits richer metadata per node (technology, kind enum, group);
 *   - opens the door to deterministic round-tripping back to Mermaid via
 *     `irToMermaid` for users who still want the source.
 */
