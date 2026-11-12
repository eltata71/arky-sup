/**
 * El detector que vigila lecturas del catálogo de fábrica se prueba a sí mismo:
 * lo que SÍ debe marcar y lo que NO. Un guard más estrecho de lo que su nombre
 * promete pasa en verde justo cuando hace falta (L1 de la revisión de #291).
 */
import { describe, expect, it } from 'vitest';
import { countFactoryPersonaReads, FACTORY_CATALOG } from './support/factoryPersonaReads';

const reads = (code: string, fileName?: string) =>
  countFactoryPersonaReads(`import { ${FACTORY_CATALOG} } from 'x';\n${code}`, fileName);
const NS = "import * as A from 'x';\n";

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

  describe('modo según la extensión y fallo cerrado (M1)', () => {
    it('lee un genérico <T>( en .ts sin perder las lecturas siguientes', () => {
      expect(reads('const g = <T>(v: T) => v;\nconst z = OFFICE_AGENT_PERSONAS.elena.alias;', 'a.ts')).toBe(1);
    });
    it('lee una aserción <any> en .ts', () => {
      expect(reads('const a = <any>OFFICE_AGENT_PERSONAS;\nconst b = OFFICE_AGENT_PERSONAS.elena.alias;', 'a.ts')).toBe(2);
    });
    it('sigue leyendo JSX en .tsx', () => {
      expect(reads('const a = <b>{OFFICE_AGENT_PERSONAS.elena.alias}</b>;', 'a.tsx')).toBe(1);
    });
    it('lanza si el fichero no parsea, en vez de devolver 0', () => {
      expect(() => reads('const a = <T>(v: T) => v;\nOFFICE_AGENT_PERSONAS.a;', 'a.tsx')).toThrow(/no parsea/);
      expect(() => reads('const = ;', 'a.ts')).toThrow(/no parsea/);
    });
    it('rechaza una extensión que no es TS', () => {
      expect(() => reads('const a = 1;', 'a.js')).toThrow(/extensión/);
    });
  });

  describe('import de namespace (M2)', () => {
    it.each([
      ['punto', `${NS}const a = A.OFFICE_AGENT_PERSONAS[id].alias;`, 1],
      ['corchete con literal', `${NS}const a = A['OFFICE_AGENT_PERSONAS'][id].alias;`, 1],
      ['plantilla sin sustituciones', `${NS}const a = A[\`OFFICE_AGENT_PERSONAS\`].elena;`, 1],
      ['dos accesos', `${NS}const a = [A.OFFICE_AGENT_PERSONAS.a, A['OFFICE_AGENT_PERSONAS'].b];`, 2],
    ])('marca %s', (_n, code, expected) => {
      expect(countFactoryPersonaReads(code, 'a.ts')).toBe(expected);
    });
    it.each([
      ['otro miembro del namespace', `${NS}const a = A.otraCosa.alias;`],
      ['otro literal', `${NS}const a = A['OTRO'];`],
      ['un objeto ajeno con el mismo nombre', 'const o = { OFFICE_AGENT_PERSONAS: 1 };\nconst a = o.OFFICE_AGENT_PERSONAS;'],
      ['import type de namespace', "import type * as A from 'x';\ntype T = typeof A.OFFICE_AGENT_PERSONAS;"],
    ])('no marca %s', (_n, code) => {
      expect(countFactoryPersonaReads(code, 'a.ts')).toBe(0);
    });
  });

  describe('falsos positivos (L1)', () => {
    it.each([
      ['keyof typeof', 'type K = keyof typeof OFFICE_AGENT_PERSONAS;'],
      ['typeof en tipo', 'let x: typeof OFFICE_AGENT_PERSONAS;'],
      ['import type + typeof', "import type { OFFICE_AGENT_PERSONAS as T } from 'y';\ntype K = keyof typeof T;"],
      ['miembro de enum homónimo', 'enum E { OFFICE_AGENT_PERSONAS = 1 }'],
      ['método homónimo', 'class C { OFFICE_AGENT_PERSONAS() { return 1; } }'],
      ['atributo JSX homónimo', 'const a = <b OFFICE_AGENT_PERSONAS="x" />;'],
    ])('no marca %s', (_n, code) => {
      expect(reads(code, 'a.tsx')).toBe(0);
    });
    it('no marca un parámetro que sombrea el alias de importación', () => {
      const code = `import { ${FACTORY_CATALOG} as P } from 'x';\nconst f = (P: number) => P;`;
      expect(countFactoryPersonaReads(code)).toBe(0);
    });
    it('sí marca la propiedad abreviada, que lee el catálogo', () => {
      expect(reads('const o = { OFFICE_AGENT_PERSONAS };')).toBe(1);
    });
  });

  describe('reexportación local (L2)', () => {
    it('marca export { P as X } sobre el alias', () => {
      const code = `import { ${FACTORY_CATALOG} as P } from 'x';\nexport { P as Catalogo };`;
      expect(countFactoryPersonaReads(code)).toBe(1);
    });
    it('no marca export type ni un export ajeno', () => {
      const code = `import { ${FACTORY_CATALOG} as P } from 'x';\nconst Q = 1;\nexport { Q };\nexport type { P as T };`;
      expect(countFactoryPersonaReads(code, 'a.ts')).toBe(0);
    });
  });
});
