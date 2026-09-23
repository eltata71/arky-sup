/**
 * Convert a diagram into an Excalidraw scene. Moved out of the engine in
 * F5-01 (corte 6); a failure returns `null` so the view can fall back.
 */
import type { Settings } from '../../../../types';
import { cleanJsonString } from '../../../../utils';
import { resolveModelForSettings } from '../../catalog';
import { aiGateway } from '../aiGateway';
import { buildDiagramGenerationConfig } from './diagramGenerationConfig';

export async function convertToExcalidrawJSON(
    mermaidContent: string,
    settings: Settings,
    isDark: boolean = false
): Promise<{ elements: unknown[] } | null> {
    // Semantic color palette — chosen to be vivid and readable in both modes
    const colors = isDark ? {
        person:   { bg: '#1e3a5f', stroke: '#60a5fa', text: '#bfdbfe' },
        api:      { bg: '#2e1065', stroke: '#c084fc', text: '#e9d5ff' },
        service:  { bg: '#1e1b4b', stroke: '#818cf8', text: '#c7d2fe' },
        database: { bg: '#064e3b', stroke: '#34d399', text: '#a7f3d0' },
        external: { bg: '#451a03', stroke: '#fbbf24', text: '#fde68a' },
        queue:    { bg: '#3b2200', stroke: '#fcd34d', text: '#fef9c3' },
        cloud:    { bg: '#0c4a6e', stroke: '#38bdf8', text: '#bae6fd' },
        generic:  { bg: '#1e293b', stroke: '#94a3b8', text: '#e2e8f0' },
    } : {
        person:   { bg: '#dbeafe', stroke: '#2563eb', text: '#1e3a8a' },
        api:      { bg: '#ede9fe', stroke: '#7c3aed', text: '#2e1065' },
        service:  { bg: '#e0e7ff', stroke: '#4f46e5', text: '#1e1b4b' },
        database: { bg: '#d1fae5', stroke: '#059669', text: '#064e3b' },
        external: { bg: '#fef3c7', stroke: '#d97706', text: '#451a03' },
        queue:    { bg: '#fef9c3', stroke: '#ca8a04', text: '#713f12' },
        cloud:    { bg: '#e0f2fe', stroke: '#0284c7', text: '#0c4a6e' },
        generic:  { bg: '#f1f5f9', stroke: '#64748b', text: '#0f172a' },
    };

    const arrowColor = isDark ? '#94a3b8' : '#64748b';
    const asyncArrowColor = isDark ? '#fbbf24' : '#d97706';

    const prompt = `You are a professional software architecture diagram designer. Convert this Mermaid diagram into a visually attractive Excalidraw JSON diagram with professional styling.

ARCHITECTURE ELEMENT COLORS (use exact hex values based on the element's role):
- Person/Actor/User: backgroundColor="${colors.person.bg}", strokeColor="${colors.person.stroke}"
- API/Gateway/Proxy/Load-Balancer: backgroundColor="${colors.api.bg}", strokeColor="${colors.api.stroke}"
- Service/Backend/System/Module/Application: backgroundColor="${colors.service.bg}", strokeColor="${colors.service.stroke}"
- Database/Cache/Store/Redis/SQL/Mongo: backgroundColor="${colors.database.bg}", strokeColor="${colors.database.stroke}"
- External/Third-Party/Legacy/Vendor: backgroundColor="${colors.external.bg}", strokeColor="${colors.external.stroke}"
- Queue/Broker/Kafka/RabbitMQ/Event: backgroundColor="${colors.queue.bg}", strokeColor="${colors.queue.stroke}"
- Cloud/SaaS/AWS/Azure/GCP: backgroundColor="${colors.cloud.bg}", strokeColor="${colors.cloud.stroke}"
- Generic fallback: backgroundColor="${colors.generic.bg}", strokeColor="${colors.generic.stroke}"

SHAPE RULES:
- Persons/Actors → type="ellipse"
- Databases/Caches → type="rectangle" (cylinder-style with thicker border, strokeWidth=3)
- API Gateways/Decision nodes → type="diamond"
- Everything else → type="rectangle"

NODE LAYOUT RULES (CRITICAL — must produce readable, non-overlapping diagrams):
- Node width: 260px, height: 100px (ellipses: 180x80)
- Horizontal gap between columns: 320px (center-to-center)
- Vertical gap between rows: 200px (center-to-center)
- Layer 0 (top): Persons/Actors — start at x=200, y=80
- Layer 1: API Gateways / Entry Points — start at x=200, y=280
- Layer 2: Core Services/Systems — start at x=200, y=480
- Layer 3 (bottom): Databases, Queues, External — start at x=200, y=680
- Spread each layer horizontally: first node at column 0, next at column 1 (x+=320), etc.
- Center the layers: if 3 nodes in a layer, offset starting x so they are centered around x=600

NODE TEXT (required fields):
- text: the node label (title only, max 30 chars)
- fontSize: 15
- fontFamily: 1
- textAlign: "center"
- verticalAlign: "middle"
- strokeWidth: 2 (use 3 for databases)
- roughness: 0
- fillStyle: "solid"
- opacity: 100

SUBTITLE TEXT ELEMENTS (for each node, add a subtitle text element below the label):
- type="text", fontSize=11, text=technology/role keyword (e.g. "REST API", "PostgreSQL", "React SPA")
- Position: same x as node center, y = node.y + 28
- strokeColor="${isDark ? '#94a3b8' : '#64748b'}", backgroundColor="transparent"
- width = node width, height = 20

ARROW RULES:
- type="arrow"
- strokeColor="${arrowColor}" for synchronous, "${asyncArrowColor}" for async/event-driven
- strokeWidth: 2 for sync, 2.5 for async
- strokeDasharray for async arrows: set roughness=1 (this signals async visually)
- width=0, height=0 (arrows don't have width/height)
- points: calculate from source node center to target node center, e.g. [[0,0],[dx,dy]]
- startBinding: { "elementId": "<source-node-id>", "focus": 0, "gap": 10 }
- endBinding: { "elementId": "<target-node-id>", "focus": 0, "gap": 10 }

ARROW LABELS:
- For each arrow with a label: add a type="text" element at the midpoint between source and target
- fontSize=11, strokeColor="${isDark ? '#94a3b8' : '#475569'}", backgroundColor="${isDark ? '#1e293b' : '#f8fafc'}"
- Keep labels short (max 25 chars), trim if needed

LAYER FRAME BACKGROUNDS (CRITICAL for visual grouping):
- For EACH logical layer (e.g., "Actors", "API Gateway", "Services", "Data Layer"), create a background rectangle:
  - type="rectangle", positioned to encompass ALL nodes in that layer
  - x = leftmost node x - 40, y = layer y - 30
  - width = (rightmost node x + node width) - leftmost node x + 80
  - height = node height + 60
  - backgroundColor="${isDark ? 'rgba(30,41,59,0.15)' : 'rgba(241,245,249,0.5)'}"
  - strokeColor="${isDark ? '#334155' : '#e2e8f0'}", strokeWidth=1, strokeDasharray (dashed outline)
  - roughness=0, fillStyle="solid", opacity=40
  - PLACE these frame rectangles FIRST in the elements array (so they render behind nodes)
- Add a type="text" label for each frame at the top-left corner (x + 10, y + 5):
  - text = layer name (e.g., "Actors", "Core Services", "Data Layer")
  - fontSize=12, fontFamily=1, strokeColor="${isDark ? '#64748b' : '#94a3b8'}"

TECHNOLOGY SUBTITLES (MANDATORY for every node):
- Below each node label, add a type="text" subtitle element:
  - text = specific technology with version when possible (e.g., "PostgreSQL 15", "Spring Boot 3.x", "React 18", "Kafka 3.6")
  - Position: node center x, y = node.y + 28
  - fontSize=10, fontFamily=1, strokeColor="${isDark ? '#64748b' : '#94a3b8'}", backgroundColor="transparent"
  - width = node width, height = 16

COLOR LEGEND (bottom-right corner):
- Add a small legend group at x = max_x + 100, y = max_y - 120:
  - Title text: "Legend", fontSize=13, fontFamily=1
  - For each role used in the diagram, add a small colored rectangle (20x14) + text label:
- Person (${colors.person.bg}), API (${colors.api.bg}), Service (${colors.service.bg})
- Database (${colors.database.bg}), Queue (${colors.queue.bg}), External (${colors.external.bg})
  - Space items vertically by 22px

ARROW ROUTING:
- Arrows MUST NOT visually cross through node bodies. Route arrows around obstacles if needed.
- For arrows between nodes on the same horizontal level, add a midpoint bend to create a slight arc.
- Maintain minimum 20px gap between parallel arrows.

TITLE ELEMENT:
- Add a type="text" element at x=50, y=20 with the diagram title (inferred from context)
- fontSize=20, strokeColor="${isDark ? '#e2e8f0' : '#0f172a'}", fontFamily=1

OUTPUT FORMAT:
Respond ONLY with valid JSON: { "elements": [...] }
Do NOT include markdown fences or explanations.
Place frame background rectangles FIRST, then nodes, then subtitle texts, then arrows, then arrow labels, then legend.

MERMAID DIAGRAM TO CONVERT:
${mermaidContent}`;

    const responseSchema = {
        type: 'object',
        properties: {
            elements: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        type: { type: 'string' },
                        x: { type: 'number' },
                        y: { type: 'number' },
                        width: { type: 'number' },
                        height: { type: 'number' },
                        angle: { type: 'number' },
                        strokeColor: { type: 'string' },
                        backgroundColor: { type: 'string' },
                        fillStyle: { type: 'string' },
                        strokeWidth: { type: 'number' },
                        roughness: { type: 'number' },
                        opacity: { type: 'number' },
                        text: { type: 'string' },
                        fontSize: { type: 'number' },
                        fontFamily: { type: 'number' },
                        textAlign: { type: 'string' },
                        verticalAlign: { type: 'string' }
                    },
                    required: ['id', 'type', 'x', 'y', 'width', 'height', 'strokeColor', 'backgroundColor']
                }
            }
        },
        required: ['elements']
    };

    try {
        // Excalidraw conversion is layout-and-style mapping rather than
        // reasoning. Quick tier + thinking off is plenty. Routed through the
        // model-fallback pipeline so a 429 on flash-lite falls back instead
        // of returning null and blanking the Excalidraw view.
        const { text } = await aiGateway.generateContent(
            settings,
            resolveModelForSettings('quick', settings).id,
            prompt,
            buildDiagramGenerationConfig({
                temperature: 0.2,
                thinking: 'off',
                responseSchema,
            }),
        );
        const cleanJson = cleanJsonString(text || '');
        return JSON.parse(cleanJson || '{"elements":[]}');
    } catch (error) {
        console.error("Excalidraw conversion error:", error);
        return null;
    }
}
