import { describe, expect, it } from 'vitest';
import { ARTIFACT_TEMPLATES } from '../../../constants';
import { ADM_PHASES, groupTemplatesByAdm } from '../../../lib/artifacts/admPhases';
import { currentTemplateName, disciplineForTemplate } from '../../../lib/artifacts/documentDisciplines';
import { KANBAN_COLUMNS } from '../../../constants';

describe('ARTIFACT_TEMPLATES · standard and ADM phase (11.0)', () => {
  it('every template names its standard', () => {
    for (const template of ARTIFACT_TEMPLATES) expect((template.standard ?? "").trim(), template.name).not.toBe('');
  });

  it('every declared ADM phase is a known one', () => {
    for (const template of ARTIFACT_TEMPLATES) {
      if (template.admPhase) expect(ADM_PHASES, template.name).toContain(template.admPhase);
    }
  });

  it('no template loses its roadmap phase', () => {
    for (const template of ARTIFACT_TEMPLATES) expect(KANBAN_COLUMNS, template.name).toContain(template.phase);
  });

  it('template names stay unique and the two ADR templates are one', () => {
    const names = ARTIFACT_TEMPLATES.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter(n => /\(ADR\)/.test(n))).toEqual(['Registro de Decisiones Arquitectónicas (ADR)']);
  });

  it('groups every template exactly once, in ADM order', () => {
    const groups = groupTemplatesByAdm(ARTIFACT_TEMPLATES);
    expect(groups.flatMap(([, members]) => members)).toHaveLength(ARTIFACT_TEMPLATES.length);
    expect(groups[0][0]).toMatch(/Preliminar/);
  });
});

describe('merged ADR template', () => {
  it('an artifact saved under the legacy catalogue name resolves to the register', () => {
    expect(currentTemplateName('Catálogo de Decisiones (ADR)')).toBe('Registro de Decisiones Arquitectónicas (ADR)');
    expect(disciplineForTemplate('Catálogo de Decisiones (ADR)')).toBe(
      disciplineForTemplate('Registro de Decisiones Arquitectónicas (ADR)'),
    );
  });
});
