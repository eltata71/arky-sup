/**
 * Las clases de Mermaid leídas por su significado (plan de diagramas, 2.1),
 * sobre los diez fixtures de `tests/fixtures/mermaid-classes/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { mermaidToIR, mermaidToIRWithDiagnostics } from '../../services/diagram/mermaidToIR';
import { roleForClassName, takeClassSuffix, parseClassStatement } from '../../services/diagram/mermaidClasses';

const fixture = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/mermaid-classes', name), 'utf-8');
const roleOf = (ir: DiagramIR, id: string) => ir.nodes.find((n) => n.id === id)?.semanticRole;

describe('Mermaid con clases', () => {
  it('01 · `Nodo:::clase` sin forma ya no crea un nodo llamado «Nodo:::clase»', () => {
    const ir = mermaidToIR(fixture('01-suffix-sin-forma.mmd'));
    expect(ir.nodes.some((n) => n.id.includes(':::') || n.label.includes(':::'))).toBe(false);
    expect(roleOf(ir, 'Orders')).toBe('data');
    expect(ir.edges.some((e) => e.source === 'Api' && e.target === 'Orders')).toBe(true);
  });

  it('02 · el sufijo detrás de una forma', () => {
    const ir = mermaidToIR(fixture('02-suffix-con-forma.mmd'));
    expect(roleOf(ir, 'Web')).toBe('external');
    expect(roleOf(ir, 'Api')).toBe('service');
    expect(roleOf(ir, 'Pagos')).toBe('external');
    expect(ir.nodes.find((n) => n.id === 'Pagos')?.label).toBe('Pasarela de pagos');
  });

  it('03 · la sentencia `class` y el nombre de un `classDef`, no su color', () => {
    const ir = mermaidToIR(fixture('03-sentencia-class.mmd'));
    expect(roleOf(ir, 'D')).toBe('data');
    expect(roleOf(ir, 'G')).toBe('gateway');
    expect(JSON.stringify(ir)).not.toContain('#f96');
  });

  it('04 · una sentencia para varios nodos', () => {
    const ir = mermaidToIR(fixture('04-varios-nodos.mmd'));
    for (const id of ['A', 'B', 'C']) expect(roleOf(ir, id)).toBe('service');
    expect(roleOf(ir, 'Q')).toBe('messaging');
  });

  it('05 · nombres compuestos: gana la primera palabra que dice algo', () => {
    const ir = mermaidToIR(fixture('05-camelcase.mmd'));
    expect(roleOf(ir, 'Legacy')).toBe('external');
    expect(roleOf(ir, 'Cache')).toBe('data');
  });

  it('06 · una clase de estilo se informa y no se adivina', () => {
    const { ir, diagnostics } = mermaidToIRWithDiagnostics(fixture('06-no-reconocida.mmd'));
    expect(diagnostics.unmappedClasses).toEqual(['critical', 'highlight']);
    expect(ir.nodes.map((n) => n.id).sort()).toEqual(['A', 'B']);
  });

  it('07 · dentro de un subgrafo, la agrupación se conserva', () => {
    const ir = mermaidToIR(fixture('07-subgrafo.mmd'));
    expect(roleOf(ir, 'R')).toBe('data');
    expect(roleOf(ir, 'P')).toBe('data');
    expect(ir.groups.find((g) => g.label === 'Datos')?.nodeIds.sort()).toEqual(['P', 'R']);
  });

  it('08 · varias clases: la primera reconocible', () => {
    const { ir, diagnostics } = mermaidToIRWithDiagnostics(fixture('08-varias-clases.mmd'));
    expect(roleOf(ir, 'Bus')).toBe('messaging');
    expect(diagnostics.unmappedClasses).toEqual(['highlight']);
  });

  it('09 · el diccionario de personas gana a una clase mal puesta', () => {
    const ir = mermaidToIR(fixture('09-persona-gana.mmd'));
    expect(roleOf(ir, 'Asegurado')).toBe('person');
  });

  it('10 · `style` y `linkStyle` siguen ignorándose; el nombre de la clase no', () => {
    const { ir, diagnostics } = mermaidToIRWithDiagnostics(fixture('10-con-estilos.mmd'));
    expect(roleOf(ir, 'B')).toBe('service');
    expect(ir.edges).toHaveLength(1);
    expect(diagnostics.unmappedClasses).toBeUndefined();
  });
});

describe('piezas', () => {
  it('roleForClassName', () => {
    expect(roleForClassName('db')).toBe('data');
    expect(roleForClassName('thirdParty')).toBe('external');
    expect(roleForClassName('ext_db')).toBe('external');
    expect(roleForClassName('loadBalancer')).toBe('gateway');
    expect(roleForClassName('highlight')).toBeNull();
  });

  it('takeClassSuffix y parseClassStatement', () => {
    expect(takeClassSuffix('A[Etiqueta]:::db')).toEqual({ token: 'A[Etiqueta]', classes: ['db'] });
    expect(takeClassSuffix('A[Etiqueta]')).toEqual({ token: 'A[Etiqueta]', classes: [] });
    expect(parseClassStatement('class A,B db')).toEqual({ nodeIds: ['A', 'B'], classes: ['db'] });
    expect(parseClassStatement('classDef db fill:#f96')).toBeNull();
  });
});
