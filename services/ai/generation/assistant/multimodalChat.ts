/**
 * The chat modal's turn: guided project creation, document analysis, or the
 * general assistant with the user's projects and courses as context — with
 * uploaded files attached to the last user turn. Moved out of the engine in
 * F5-01 (corte 7); the instructions are unchanged, and the course context is
 * typed now instead of read through `any`.
 */
import type { ChatModalPurpose, Settings, UploadedFile } from '../../../../types';
import type { Project } from '../../../architectureProjects';
import { resolveModelForSettings } from '../../catalog';
import { aiGateway } from '../aiGateway';
import type { AssistantConversationTurn, AssistantCourseSummary } from './assistantPorts';

const PROJECT_JSON_SHAPE = '{"action": "createProject", "data": {"name": "...", "description": "...", "projectContext": [...], "initialArtifacts": [...]}}';

function describeCourse(course: AssistantCourseSummary): string {
    const lessons = (course.modules ?? [])
        .map((module) => (module.lessons ?? []).map((lesson) => `- ${lesson.title}: ${lesson.description}`).join('\n'))
        .join('\n');
    return `Course: ${course.title}\nDescription: ${course.description}\nCategory: ${course.category}\nLevel: ${course.level}\nKnowledge Cards (Lessons):\n${lessons}\n\n`;
}

function buildMultimodalInstruction(
    purpose: ChatModalPurpose,
    settings: Settings,
    projects?: readonly Project[],
    courses?: readonly AssistantCourseSummary[],
): string {
    if (purpose === 'guided-creation') {
        return `Guide user to define project. Once clear (3-4 q's), return JSON: ${PROJECT_JSON_SHAPE}. Else, converse.`;
    }
    if (purpose === 'analyze-document') {
        return `Analyze docs. Return JSON: ${PROJECT_JSON_SHAPE}.`;
    }
    let instruction = `You are an expert solution architect, acting as Arquitecto Agente.
            
CRITICAL INDUSTRY CONTEXT:
This platform is a service provided to an Insurance Company that offers Life and Health products. 
Whenever you are answering ANY question, you MUST take this into account. 
You must adhere to the highest standards of the Life and Health Insurance industry, as well as the best standards in Technology.

Global Context/Standards:
${settings.globalContext.map(c => `- ${c}`).join('\n')}

Review architecture and provide feedback. If the user asks specific information about a project or a course, you MUST use the provided context below to answer. If the user asks general questions, provide advice based on your knowledge as Arquitecto Agente.

`;
    if (projects && projects.length > 0) {
        instruction += `\n\n--- EXISTING PROJECTS CONTEXT ---\n`;
        projects.forEach(p => {
            instruction += `Project: ${p.name}\nDescription: ${p.description}\nArtifacts:\n${p.artifacts.map(a => `- ${a.name} (${a.type}): ${a.objective}`).join('\n')}\n\n`;
        });
    }
    if (courses && courses.length > 0) {
        instruction += `\n\n--- EXISTING COURSES CONTEXT ---\n`;
        courses.forEach(course => { instruction += describeCourse(course); });
    }
    return instruction;
}

export async function processMultimodalChat(
    purpose: ChatModalPurpose,
    history: readonly AssistantConversationTurn[],
    _question: string,
    files: readonly UploadedFile[],
    settings: Settings,
    projects?: readonly Project[],
    courses?: readonly AssistantCourseSummary[],
): Promise<string> {
    const tone = settings.aiConfig?.tone || 'Professional';
    const instruction = `${buildMultimodalInstruction(purpose, settings, projects, courses)} Tone: ${tone}.`;

    // The files travel with the last user turn only: that is the turn that
    // uploaded them, and repeating them on every turn would resend the bytes.
    const contents = history.map((message, index) => {
        const isLastUserTurn = index === history.length - 1 && message.role === 'user';
        return {
            role: message.role,
            parts: [
                { text: message.content },
                ...(isLastUserTurn ? files.map(f => ({ inlineData: { mimeType: f.type, data: f.base64Data } })) : []),
            ],
        };
    });

    const modelName = resolveModelForSettings('default', settings).id;

    const result = await aiGateway.generateContent(
        settings,
        modelName,
        contents,
        {
            systemInstruction: instruction,
            temperature: settings.aiConfig?.temperature ?? 0.7,
        },
        { maxRetries: 1 },
    );
    return result.text;
}
