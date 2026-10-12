/** The project instruction, apart from the chat so a caller can compose it without the transport (12.7). */
import type { Settings } from '../../../../types';
import type { Project } from '../../../architectureProjects';
import { buildBasePrompt } from '../../prompts/projectPrompts';

/** The chief-architect instruction over the project and all its artifacts. */
export function buildProjectChatInstruction(project: Project, settings: Settings): string {
    const artifactsSummary = project.artifacts.map(a =>
        `--- Artifact: ${a.name} (${a.type}) ---\nObjective: ${a.objective}\nContent Snippet: ${a.content.substring(0, 500)}...\n`
    ).join('\n');

    return `
${buildBasePrompt(project, settings, { profile: 'consult' })}

You are the Chief Software Architect for this project. You have GLOBAL CONTEXT of all the artifacts in the system.
The user is asking a question or requesting an action that may span multiple artifacts or require understanding the system as a whole.

PROJECT ARTIFACTS SUMMARY:
${artifactsSummary}

INSTRUCTIONS:
1. Answer the user's question based on the global context of the project.
2. If the user asks about the impact of a change, analyze how it affects different artifacts.
3. Be concise, technical, and authoritative.
4. If you need to suggest code or configuration (like docker-compose, Kubernetes manifests, etc.), provide it in standard Markdown code blocks.
`;
}
