import type { DiagramIR } from '../../lib/diagram';
import { mermaidToIR } from './mermaidToIR';
import { serializeArchimateExchange } from './notation/archimateExchange';

/** Open Group Exchange XML of an ArchiMate artifact, or null when it is not one. */
export function archimateExchangeXml(content: string, ir?: DiagramIR | null): string | null {
  const model = ir?.notation?.dialect === 'archimate' ? ir : mermaidToIR(content);
  return serializeArchimateExchange(model);
}
