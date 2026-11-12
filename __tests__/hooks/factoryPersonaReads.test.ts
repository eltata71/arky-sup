/**
 * El detector que vigila lecturas del catálogo de fábrica se prueba a sí mismo:
 * lo que SÍ debe marcar y lo que NO. Un guard más estrecho de lo que su nombre
 * promete pasa en verde justo cuando hace falta (L1 de la revisión de #291).
 */
import { describe, expect, it } from 'vitest';
import { countFactoryPersonaReads, FACTORY_CATALOG } from './support/factoryPersonaReads';

const reads = (code: string) => countFactoryPersonaReads(`import { ${FACTORY_CATALOG} } from 'x';\n${code}`);

describe('countFactoryPersonaReads', () => {
  it.each([
    ['corchete', 'const a = OFFICE_AGENT_PERSONAS[id].role;'],
    ['corchete separado por blanco', 'const a = OFFICE_AGENT_PERSONAS [id].role;'],
    ['corchete opcional', 'const a = OFFICE_AGENT_PERSONAS[id]?.alias;'],
    ['punto', 'const a = OFFICE_AGENT_PERSONAS.elena.role;'],
    ['punto tras salto de línea', 'const a = OFFICE_AGENT_PERSONAS\n  .elena.role;'],
    ['Object.values', 'Object.values(OFFICE_AGENT_PERSONAS).map((p) => p.alias);'],
    ['Object.entries con blancos', 'Object.entries( OFFICE_AGENT_PERSONAS ).map(([, p]) => p.role);'],
    ['desestructuración', 'const { elena } = OFFICE_AGENT_PERSONAS;'],
    ['alias por variable', 'const personas = OFFICE_AGENT_PERSONAS;'],
    ['propagación', 'const copia = { ...OFFICE_AGENT_PERSONAS };'],
    ['plantilla', 'const a = `${OFFICE_AGENT_PERSONAS[id].alias}`;'],
  ])('marca %s', (_name, code) => {
    expect(reads(code)).toBeGreaterThan(0);
  });

  it('marca la lectura por un alias de importación', () => {
    const code = `import { ${FACTORY_CATALOG} as Personas } from 'x';\nconst a = Personas.elena.role;\nconst b = Personas[id].alias;`;
    expect(countFactoryPersonaReads(code)).toBe(2);
  });

  it('cuenta una lectura por cada referencia', () => {
    expect(reads('const a = [OFFICE_AGENT_PERSONAS.a.role, OFFICE_AGENT_PERSONAS[b].alias];')).toBe(2);
  });

  it.each([
    ['Object.keys, que sólo cuenta', 'const n = Object.keys(OFFICE_AGENT_PERSONAS).length;'],
    ['un comentario', '// OFFICE_AGENT_PERSONAS[id].alias\n/* OFFICE_AGENT_PERSONAS.elena */'],
    ['una cadena', "const s = 'OFFICE_AGENT_PERSONAS[id].alias';"],
    ['una propiedad homónima', 'const a = ficha.OFFICE_AGENT_PERSONAS;'],
    ['otro identificador', 'const a = OFFICE_AGENT_PERSONAS_EXTRA[id].role;'],
    ['el alias configurado', 'const a = useAgentDisplayName()(id);'],
  ])('no marca %s', (_name, code) => {
    expect(reads(code)).toBe(0);
  });

  it('no cuenta la importación ni la reexportación', () => {
    const code = `import { ${FACTORY_CATALOG} as P } from 'x';\nexport { ${FACTORY_CATALOG} } from 'x';`;
    expect(countFactoryPersonaReads(code)).toBe(0);
  });
});
