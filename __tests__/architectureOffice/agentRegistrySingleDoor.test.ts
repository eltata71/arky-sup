/**
 * One door onto "which agent?".
 *
 * The question used to be answered in three places — `officeAgentPersonas` held
 * the producer/reviewer finders, `OfficeAgentRouter` held the workstream rule,
 * and anything else filtered `OFFICE_AGENT_PERSONAS` inline. Three doors onto
 * one table is not a style problem: it is how the Office ended up with two
 * routing tables that disagreed about whether "Health Cloud" is AWS work, and
 * nothing said where the answer was supposed to come from.
 *
 * So the rule is scanned rather than agreed: outside the registry and the file
 * that holds the values, nothing may *select* from the record. Counting the
 * roster or rendering all of it is not selection and stays allowed — a rule
 * with no exceptions would be one people route around.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OFFICE = 'services/architectureOffice';
/** The registry implements the lookups; the persona file owns the values. */
const OWNERS = new Set([
  join(OFFICE, 'domain', 'agentRegistry.ts'),
  join(OFFICE, 'domain', 'officeAgentPersonas.ts'),
]);

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? filesUnder(full) : full.endsWith('.ts') ? [full] : [];
  });
}

/** Source with comments stripped — a docblock must be free to name the rule. */
const codeOf = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const candidates = filesUnder(OFFICE).filter((file) => !OWNERS.has(file));

describe('the agent registry is the only selector', () => {
  it.each(candidates)('%s does not filter the persona record inline', (file) => {
    const code = codeOf(file);
    // `Object.values(OFFICE_AGENT_PERSONAS).filter(...)` / `.find(...)`
    expect(
      /Object\.(values|entries|keys)\(\s*OFFICE_AGENT_PERSONAS\s*\)[\s\S]{0,40}?\.(filter|find)\(/.test(code),
      'usa el registro (findAgentsBy*, listAgents) en vez de filtrar el record',
    ).toBe(false);
  });

  it('leaves exactly one implementation of each lookup', () => {
    const registry = codeOf(join(OFFICE, 'domain', 'agentRegistry.ts'));
    for (const name of [
      'findAgentsByCapability',
      'findAgentsByDomain',
      'findAgentsThatProduce',
      'findAgentsThatReview',
      'canTakeWorkstream',
      'canDelegate',
    ]) {
      expect(registry, name).toContain(`export const ${name}`);
      const elsewhere = candidates.filter((file) => codeOf(file).includes(`export const ${name}`));
      expect(elsewhere, `${name} está definido dos veces`).toEqual([]);
    }
  });
});
