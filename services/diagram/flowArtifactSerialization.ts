import type { DiagramIR } from '../../lib/diagram';
import { irToMermaid } from './irToMermaid';
import { irToReactFlow } from './irToReactFlow';

/** The IR written for a flowchart (`mermaid-graph`, as Mermaid) or a React Flow artifact (as its JSON). */
export function serializeFlowArtifact(ir: DiagramIR, artifactType: 'mermaid-graph' | 'react-flow-graph'): string {
    return artifactType === 'react-flow-graph' ? JSON.stringify(irToReactFlow(ir)) : irToMermaid(ir);
}
