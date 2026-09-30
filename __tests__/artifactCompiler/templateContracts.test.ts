/**
 * Un documento del catálogo se comprueba con el contrato de su disciplina
 * (plan de calidad de artefactos, 7.4a): un ADR sin decisión o un DRP sin
 * RTO/RPO ya no pasan el contrato genérico.
 */
import { describe, expect, it } from 'vitest';
import { resolveContract } from '../../services/artifactCompiler/ArtifactContractRegistry';
import { validateAgainstContract } from '../../services/artifactCompiler/validators/contractValidator';
import { compileArtifact } from '../../services/artifactCompiler';
import { DOCUMENT_DISCIPLINES, describeDisciplineForPrompt } from '../../lib/artifacts';
import { ARTIFACT_TEMPLATES } from '../../constants';
import { makeArtifact } from './fixtures';

const adr = (body: string) =>
  makeArtifact({ name: 'Registro de Decisiones Arquitectónicas (ADR)', type: 'markdown', representation: 'document', content: body });

const COMPLETE_ADR = `# ADR-001: Mensajería gestionada

## Estado
Aceptada.

## Contexto
Las solicitudes de autorización previa se encadenan de forma síncrona y superan los 40 segundos en campaña.

## Decisión
Se adopta un bus de eventos gestionado para desacoplar la recepción de la adjudicación.

## Alternativas consideradas
| Opción | Resultado |
| --- | --- |
| Llamadas síncronas | Descartada |

## Consecuencias
Escala en campaña; exige aprender una capacidad operativa nueva.
`;

describe('contratos por plantilla', () => {
  it('cada plantilla markdown del catálogo tiene su disciplina', () => {
    const markdownTemplates = ARTIFACT_TEMPLATES.filter((t) => t.type === 'markdown').map((t) => t.name).sort();
    expect(DOCUMENT_DISCIPLINES.map((d) => d.templateName).sort()).toEqual(markdownTemplates);
  });

  it('un documento del catálogo resuelve el contrato de su disciplina; uno cualquiera, el genérico', () => {
    expect(resolveContract('markdown', 'Registro de Decisiones Arquitectónicas (ADR)').label).toBe('Registro de Decisión Arquitectónica');
    expect(resolveContract('markdown', 'Un documento sin plantilla').id).toBe('contract.document.markdown');
    expect(resolveContract('markdown').id).toBe('contract.document.markdown');
  });

  it('un ADR completo cumple su contrato', () => {
    const result = validateAgainstContract(adr(COMPLETE_ADR), resolveContract('markdown', 'Registro de Decisiones Arquitectónicas (ADR)'));
    expect(result.issues.filter((issue) => issue.code === 'CONTRACT_MISSING_SECTION')).toEqual([]);
  });

  it('un ADR sin consecuencias ni estado de su ciclo de vida no pasa', () => {
    const gutted = COMPLETE_ADR.replace(/## Consecuencias[\s\S]*$/, '').replace('## Estado\nAceptada.', '## Estado\nPor definir.');
    const { issues } = compileArtifact(adr(gutted), { applyRepairs: false });
    const all = Object.values(issues).flat();
    expect(all.some((issue) => issue.message.includes('Consecuencias'))).toBe(true);
    expect(all.some((issue) => issue.code === 'CONTRACT_CONTENT_RULE' && issue.message.includes('estado'))).toBe(true);
  });

  it('un DRP exige RTO y RPO con cifra y unidad', () => {
    const drp = (text: string) => makeArtifact({ name: 'Plan de Recuperación ante Desastres (DRP)', type: 'markdown', representation: 'document', content: text });
    const contract = resolveContract('markdown', 'Plan de Recuperación ante Desastres (DRP)');
    const withoutValues = validateAgainstContract(drp('# DRP\n\n## Objetivos de recuperación (RTO/RPO)\nSe definirán más adelante.'), contract);
    expect(withoutValues.issues.some((issue) => issue.id === 'contract.rule.drp-rto-rpo-values')).toBe(true);
    const withValues = validateAgainstContract(drp('# DRP\n\n## Objetivos de recuperación (RTO/RPO)\nRTO de 4 horas y RPO de 15 minutos para adjudicación.'), contract);
    expect(withValues.issues.some((issue) => issue.id === 'contract.rule.drp-rto-rpo-values')).toBe(false);
  });

  it('una sección que falta se informa, nunca se rellena con un marcador', () => {
    const gutted = COMPLETE_ADR.replace(/## Decisión[\s\S]*?(?=## Alternativas)/, '');
    const result = compileArtifact(adr(gutted));
    expect(result.compiled.content).not.toMatch(/## Decisión/);
  });
});

describe('describeDisciplineForPrompt', () => {
  it('pide al modelo los mismos encabezados que el contrato comprueba', () => {
    const block = describeDisciplineForPrompt('Plan de Recuperación ante Desastres (DRP)');
    for (const section of DOCUMENT_DISCIPLINES.find((d) => d.templateName.startsWith('Plan de Recuperación'))!.sections) {
      expect(block).toContain(`## ${section.label}`);
    }
    expect(block).toContain('RTO y RPO con cifra y unidad');
  });

  it('no dice nada de una plantilla sin disciplina', () => {
    expect(describeDisciplineForPrompt('Diagrama de Contexto (C4-N1)')).toBe('');
  });
});
