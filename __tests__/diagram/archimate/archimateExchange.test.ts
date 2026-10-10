// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mermaidToIR } from '../../../services/diagram/mermaidToIR';
import { serializeArchimateExchange } from '../../../services/diagram/notation/archimateExchange';
import { getExportCapabilities } from '../../../services/export/exportRegistry';
import { ARCHIMATE_ELEMENT_TYPES, ARCHIMATE_RELATION_TYPES } from '../../../lib/archimate/archimateMetamodel';

const SOURCE = [
  '%% archimate viewpoint=layered',
  'flowchart LR',
  '  C["Cliente & Asegurado"]',
  '  S["Portal"]',
  '  A["Plataforma"]',
  '  C -->|serving: consulta <web>| S',
  '  S -->|realization| A',
  '  class C archimate_business_actor',
  '  class S archimate_application_component',
  '  class A archimate_node',
].join('\n');

describe('ArchiMate Model Exchange', () => {
  const xml = serializeArchimateExchange(mermaidToIR(SOURCE)) as string;

  it('escribe elementos, relaciones y una vista con tipos PascalCase', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="http://www.opengroup.org/xsd/archimate/3.0/"');
    expect(xml).toContain('xsi:type="BusinessActor"');
    expect(xml).toContain('xsi:type="ApplicationComponent"');
    expect(xml).toContain('xsi:type="Node"');
    expect(xml).toContain('xsi:type="Serving"');
    expect(xml).toContain('xsi:type="Realization"');
    expect(xml).toContain('viewpoint="layered"');
    expect((xml.match(/<node /g) ?? []).length).toBe(3);
    expect((xml.match(/<connection /g) ?? []).length).toBe(2);
  });

  it('escapa el texto y es XML bien formado', () => {
    expect(xml).toContain('Cliente &amp; Asegurado');
    expect(xml).toContain('consulta &lt;web&gt;');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror').length).toBe(0);
  });

  it('cada referencia apunta a un identificador que existe', () => {
    const ids = new Set(Array.from(xml.matchAll(/identifier="([^"]+)"/g)).map((m) => m[1]));
    for (const m of xml.matchAll(/(?:source|target|elementRef|relationshipRef)="([^"]+)"/g)) expect(ids.has(m[1])).toBe(true);
  });

  it('no inventa un modelo: otro dialecto o un IR vacío devuelven null', () => {
    expect(serializeArchimateExchange(mermaidToIR('flowchart LR\n  A --> B'))).toBeNull();
  });

  it('todo tipo del metamodelo tiene su nombre PascalCase en el esquema', () => {
    for (const t of [...ARCHIMATE_ELEMENT_TYPES, ...ARCHIMATE_RELATION_TYPES]) expect(/^[a-z]+(-[a-z]+)*$/.test(t)).toBe(true);
  });

  it('el formato sólo se ofrece a los artefactos ArchiMate', () => {
    const base = { activeView: 'diagram' as const, exportAsPublication: false };
    const mk = (type: string) => ({ ...base, artifact: { id: 'a', name: 'x', type, content: SOURCE } }) as never;
    expect(getExportCapabilities(mk('mermaid-archimate'), false).some((c) => c.format === 'archimate-xml')).toBe(true);
    expect(getExportCapabilities(mk('mermaid-flowchart'), true).some((c) => c.format === 'archimate-xml')).toBe(false);
  });
});
