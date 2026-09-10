/**
 * Course authoring — syllabus, topics, role catalog and diagnostics.
 *
 * Extracted from `services/geminiService.ts` as the first vertical of the
 * strangler migration. The LMS was the right one to move first: ten public
 * methods, 451 lines, and — measured before touching anything — **zero**
 * callers inside the monolith. Nothing else depended on it, so the extraction
 * could be exact rather than negotiated.
 *
 * The three engine calls each had a neutral equivalent already: the model call
 * is `aiGateway.generateContent`, and the persona and JSON helpers were
 * already shared functions in `utils` that the monolith merely wrapped in
 * private methods. What is gone is the class, not the behaviour.
 */

import type { Settings } from '../../../../types';
import { buildLMSTutorPersona, cleanJsonString } from '../../../../utils';
import { aiGateway } from '../aiGateway';
import { resolveModelForSettings } from '../../catalog';
import type { DiagnosticQuestion } from '../../../../types/lms';
import type { GeneratedCourse, GeneratedTopic, TopicFilters } from './learningTypes';

export async function generateCourseSyllabus(topic: string, courseContext: string | undefined, settings: Settings): Promise<GeneratedCourse> {
    const prompt = `
    ${buildLMSTutorPersona(settings)}

    As the Architect-Professor, design a comprehensive course syllabus about "${topic}" for solution architects working in the health and life insurance industry.
    ${courseContext ? `\nSpecific context provided by the student: ${courseContext}\nUse this context to tailor the modules, examples, and lesson focus to the student's specific situation, team, and technical environment.\n` : ''}
    Infer the pedagogical category (Tooling, Architecture, or Business).
    Structure it into modules and lessons for Basic, Intermediate, and Advanced levels.
    Each module should reflect real challenges and decisions architects face in insurance companies.
    Use real, up-to-date technical terminology contextualized for the insurance sector.

    Return a JSON object with this structure:
    {
        "title": "Course Title",
        "description": "Short description (max 2 sentences)",
        "category": "Tooling" | "Architecture" | "Business",
        "modules": [
            {
                "title": "Module Title",
                "level": "Básico" | "Intermedio" | "Avanzado",
                "lessons": [
                    { "id": "unique-lesson-id", "title": "Lesson Title", "description": "Brief description" }
                ]
            }
        ]
    }
    `;

    const modelName = resolveModelForSettings('default', settings).id;

    // Route through the canonical model-fallback pipeline. A 429/quota or
    // 503/overload on the preferred model (e.g. gemini-2.5-flash on the
    // shared global key) must fall back to the next model in the chain —
    // each model has an independent quota pool. The legacy
    // `retryWithBackoff` + single-model call surfaced a single 429 as a hard
    // "Se alcanzó el límite de peticiones" error, which is exactly what made
    // course generation appear dead while every other generation path
    // recovered gracefully.
    const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
        temperature: 0.7,
        responseMimeType: 'application/json'
    });
    const cleanJson = cleanJsonString(text || '');
    return JSON.parse(cleanJson || '{}');
}

export async function generateDynamicTopics(filters: TopicFilters, settings: Settings): Promise<GeneratedTopic[]> {
    const language = settings.language === 'es' ? 'Spanish' : 'English';
    
    const prompt = `
    You are an expert Software Architecture instructor.
    Generate a list of 6 to 10 "Knowledge Cards" (Topics) based on the following filters:
    - Course: ${filters.course !== 'Todos' ? filters.course : 'Any'}
    - Role: ${filters.role !== 'Todos' ? filters.role : 'Any'}
    - Level: ${filters.level !== 'Todos' ? filters.level : 'Any'}
    - Study Plan: ${filters.studyPlan !== 'Todos' ? filters.studyPlan : 'Any'}
    - Category: ${filters.category !== 'Todas' ? filters.category : 'Any'}
    - Search Term: ${filters.searchTerm || 'None'}

    If a filter is 'Any', generate a diverse mix.
    Return a JSON Array of objects with this structure:
    [{
        "id": "unique-string-id",
        "title": "Topic Title",
        "category": "Fundamentos" | "Patrones" | "Atributos de Calidad" | "Checklists" | "Preguntas Clave" | "Nube",
        "summary": "A short 2-3 sentence summary of the topic.",
        "course": "Course Name",
        "roles": ["Role1", "Role2"],
        "level": "Básico" | "Intermedio" | "Avanzado" | "Experto",
        "studyPlans": ["Plan1", "Plan2"]
    }]
    
    Ensure the output is strictly valid JSON.
    Language: ${language}.
    `;

    const modelName = resolveModelForSettings('default', settings).id;

    try {
        // Model-fallback pipeline: a 429 on the preferred model falls back to
        // the next model in the chain instead of returning an empty list.
        const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
            temperature: 0.7,
            responseMimeType: 'application/json',
            responseSchema: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        title: { type: 'string' },
                        category: { type: 'string' },
                        summary: { type: 'string' },
                        course: { type: 'string' },
                        roles: { type: 'array', items: { type: 'string' } },
                        level: { type: 'string' },
                        studyPlans: { type: 'array', items: { type: 'string' } }
                    },
                    required: ['id', 'title', 'category', 'summary', 'course', 'roles', 'level', 'studyPlans']
                }
            }
        });
        const cleanJson = cleanJsonString(text || '');
        return JSON.parse(cleanJson || '[]');
    } catch (e) {
        console.error("Error generating dynamic topics:", e);
        return [];
    }
}

export async function generateRoleCatalog(role: string, settings: Settings): Promise<GeneratedCourse[]> {
    const prompt = `
    You are an expert Chief Software Architect and Educator.
    Generate a comprehensive catalog of exactly 8 courses for the role of "${role}".
    Each course must be highly relevant to this specific role.
    
    Return a JSON array of 8 course objects with this structure:
    [
        {
            "title": "Course Title",
            "description": "Short description (max 2 sentences)",
            "category": "Tooling" | "Architecture" | "Business",
            "level": "Básico" | "Intermedio" | "Avanzado",
            "modules": [
                {
                    "title": "Module Title",
                    "level": "Básico" | "Intermedio" | "Avanzado",
                    "lessons": [
                        { "id": "unique-lesson-id", "title": "Lesson Title", "description": "Brief description" }
                    ]
                }
            ]
        }
    ]
    
    Ensure each course has at least 2 modules, and each module has at least 2 lessons (knowledge cards).
    Use real, up-to-date technical terminology.
    `;

    const modelName = resolveModelForSettings('default', settings).id;

    // Same model-fallback pipeline as course-syllabus generation so a 429 on
    // the preferred model falls back instead of hard-failing the catalog.
    const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
        temperature: 0.7,
        responseMimeType: 'application/json'
    });
    const cleanJson = cleanJsonString(text || '');
    return JSON.parse(cleanJson || '[]');
}

export async function generateRoleDiagnostic(role: string, settings: Settings): Promise<DiagnosticQuestion[]> {
    const prompt = `
    ${buildLMSTutorPersona(settings)}

    Genera un diagnóstico de competencias de 6 preguntas de opción múltiple para evaluar a un "${role}" en el sector asegurador.
    Cada pregunta evalúa un ÁREA de competencia distinta y relevante para el rol (p. ej. integración, datos, seguridad, resiliencia, nube, gobierno).
    Las preguntas deben discriminar nivel real (no triviales). Cada una con 4 opciones y una sola correcta.

    Devuelve SOLO un array JSON: [{ "area": "Nombre del área", "question": "Enunciado", "options": ["A","B","C","D"], "correctIndex": 0 }]
    `;
    const modelName = resolveModelForSettings('default', settings).id;
    const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
        temperature: 0.5,
        responseMimeType: 'application/json',
    });
    const cleanJson = cleanJsonString(text || '');
    const parsed = JSON.parse(cleanJson || '[]');
    return Array.isArray(parsed) ? parsed : [];
}
