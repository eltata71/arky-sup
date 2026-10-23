import { describe, expect, it } from 'vitest';
import { governTools } from '../../../../services/ai/tools';
import { createToolRegistry } from '../../../../services/ai/tools/registry';
import { createListOfficeStandardsTool } from '../../../../services/ai/tools/officeReadTools';
import { READ_TOOL_NAMES } from '../../../../lib/agents/readToolNames';
import { ROLE_TOOL_POLICY, allowedToolsFor, validateAgentDefinition } from '../../../../services/architectureOffice/domain/agentDefinition';
import { OFFICE_AGENT_PERSONAS } from '../../../../services/architectureOffice/domain/officeAgentPersonas';
import { createStandardsReadPort } from '../../../../services/architectureOffice/application/contextReadPorts';

const registry = () => createToolRegistry([createListOfficeStandardsTool(createStandardsReadPort())]);

describe('governTools', () => {
  it('ofrece al modelo sólo lo permitido', () => {
    expect(governTools(registry(), []).definitions()).toEqual([]);
    expect(governTools(registry(), ['list_office_standards']).definitions().map((d) => d.name)).toEqual(['list_office_standards']);
  });

  it('rechaza una herramienta no permitida, la registra y no la ejecuta', async () => {
    const governed = governTools(registry(), ['read_artifact']);
    const result = await governed.execute('list_office_standards', {});
    expect(result.ok).toBe(false);
    expect(result.text).toContain('no está permitida');
    expect(result.text).toContain('read_artifact');
    expect(governed.denied()).toEqual([{ name: 'list_office_standards', allowed: ['read_artifact'] }]);
  });

  it('ejecuta una herramienta permitida sin registrar rechazos', async () => {
    const governed = governTools(registry(), ['list_office_standards']);
    const result = await governed.execute('list_office_standards', {});
    expect(result.ok).toBe(true);
    expect(governed.denied()).toEqual([]);
  });
});

describe('ROLE_TOOL_POLICY', () => {
  it('sólo nombra herramientas que existen y nunca queda vacía', () => {
    for (const tools of Object.values(ROLE_TOOL_POLICY)) {
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) expect(READ_TOOL_NAMES).toContain(tool);
    }
  });

  it('el coordinador no lee artefactos y el consolidador no ve su detalle', () => {
    expect(ROLE_TOOL_POLICY.coordinator).not.toContain('read_artifact');
    expect(ROLE_TOOL_POLICY.coordinator).not.toContain('search_artifacts');
    expect(ROLE_TOOL_POLICY.consolidator).not.toContain('read_artifact');
    expect(ROLE_TOOL_POLICY.participant).toContain('read_artifact');
  });

  it('cada agente de la Oficina tiene política y su definición valida', () => {
    for (const agent of Object.values(OFFICE_AGENT_PERSONAS)) {
      expect(allowedToolsFor(agent).length).toBeGreaterThan(0);
      expect(validateAgentDefinition(agent).filter((i) => i.code === 'invalid-tool-policy')).toEqual([]);
    }
  });
});
