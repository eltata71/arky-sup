/**
 * The industry pack as the model reads it (plan de diagramas, 6.4).
 *
 * Written by the application, so it is not fenced: it is guidance, and it
 * says so. Two limits keep it from reshaping every diagram into a textbook:
 * it names what to call things and how to classify them, never what to add
 * that the request did not ask for; and it says which pack is active and why,
 * so a reader of the prompt — or of the trace — can challenge a wrong one.
 */
import type { ResolvedDomainPack } from '../../../lib/domainPacks';

const SOURCE: Record<ResolvedDomainPack['source'], string> = {
    iniciativa: 'la iniciativa',
    proyecto: 'el proyecto',
};

export function buildDomainPackBlock(resolved: readonly ResolvedDomainPack[]): string {
    return resolved.map(({ pack, source, evidence }) => [
        `PAQUETE DE DOMINIO — ${pack.name} (activado por ${SOURCE[source]}: ${evidence.join(', ')}).`,
        'Úsalo para nombrar, clasificar y elegir estándares; no añadas lo que la solicitud no pide.',
        `- Entidades canónicas (usa estos nombres si el diagrama las incluye): ${pack.entities.join('; ')}.`,
        '- Flujos típicos:',
        ...pack.flows.map((flow) => `    • ${flow}`),
        '- Estándares y cuándo aplican:',
        ...pack.standards.map((standard) => `    • ${standard.name}: ${standard.use}`),
        '- Reglas de datos:',
        ...pack.dataRules.map((rule) => `    • ${rule}`),
    ].join('\n')).join('\n\n');
}
