/**
 * ArchiMate Model Exchange File Format 3.x (The Open Group) for an ArchiMate IR.
 *
 * Elements, relationships and one view with the nodes in their canvas
 * positions, so Archi, BiZZdesign or Sparx can open what Arky drew. Pure: it
 * returns text, or `null` when the diagram is not an ArchiMate model or has no
 * nodes — a file with nothing in it is not an export.
 */
import type { DiagramIR } from '../../../lib/diagram';

const NAMESPACE = 'http://www.opengroup.org/xsd/archimate/3.0/';
const SCHEMA_LOCATION = 'http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd';
const NODE_WIDTH = 160;
const NODE_HEIGHT = 70;

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pascalCase = (value: string): string =>
  value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');

const xmlId = (prefix: string, id: string): string => `${prefix}-${id.replace(/[^A-Za-z0-9_.-]/g, '_')}`;

export function serializeArchimateExchange(ir: DiagramIR): string | null {
  const notation = ir.notation;
  if (notation?.dialect !== 'archimate' || ir.nodes.length === 0) return null;

  const elements = ir.nodes.filter((node) => notation.elements[node.id]);
  const known = new Set(elements.map((node) => node.id));
  const relations = ir.edges.filter((edge) => notation.relations[edge.id] && known.has(edge.source) && known.has(edge.target));
  const title = ir.metadata?.title?.trim() || 'Modelo ArchiMate';

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<model xmlns="${NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${NAMESPACE} ${SCHEMA_LOCATION}" identifier="id-model">`,
    `  <name xml:lang="es">${escapeXml(title)}</name>`,
    '  <elements>',
  ];
  for (const node of elements) {
    lines.push(`    <element identifier="${xmlId('el', node.id)}" xsi:type="${pascalCase(notation.elements[node.id])}">`);
    lines.push(`      <name xml:lang="es">${escapeXml(node.label)}</name>`);
    lines.push('    </element>');
  }
  lines.push('  </elements>', '  <relationships>');
  for (const edge of relations) {
    const relation = notation.relations[edge.id];
    lines.push(
      `    <relationship identifier="${xmlId('rel', edge.id)}" source="${xmlId('el', edge.source)}" target="${xmlId('el', edge.target)}" xsi:type="${pascalCase(relation.type)}">`,
    );
    if (relation.text) lines.push(`      <name xml:lang="es">${escapeXml(relation.text)}</name>`);
    lines.push('    </relationship>');
  }
  lines.push('  </relationships>', '  <views>', '    <diagrams>');
  lines.push(`      <view identifier="id-view" xsi:type="Diagram" viewpoint="${escapeXml(notation.viewpoint)}">`);
  lines.push(`        <name xml:lang="es">${escapeXml(title)}</name>`);
  elements.forEach((node, index) => {
    const x = Math.round(node.position?.x ?? (index % 4) * (NODE_WIDTH + 40));
    const y = Math.round(node.position?.y ?? Math.floor(index / 4) * (NODE_HEIGHT + 40));
    lines.push(
      `        <node identifier="${xmlId('vn', node.id)}" elementRef="${xmlId('el', node.id)}" xsi:type="Element" x="${x}" y="${y}" w="${NODE_WIDTH}" h="${NODE_HEIGHT}"/>`,
    );
  });
  for (const edge of relations) {
    lines.push(
      `        <connection identifier="${xmlId('vc', edge.id)}" relationshipRef="${xmlId('rel', edge.id)}" xsi:type="Relationship" source="${xmlId('vn', edge.source)}" target="${xmlId('vn', edge.target)}"/>`,
    );
  }
  lines.push('      </view>', '    </diagrams>', '  </views>', '</model>', '');
  return lines.join('\n');
}
