/**
 * Lesson delivery — tab content, masterclasses and the tutor turn.
 *
 * Second half of the LMS vertical (see `courseAuthoring` for why this moved).
 * These compose their own prompts, which is exactly the case `aiGateway`
 * exists for: they keep provider selection, the proxy attempt, retry, timeout
 * and model fallback without re-implementing any of it.
 */

import type { Settings } from '../../../../types';
import type { StudentContext } from '../../../../types/lms';
import { buildLMSTutorPersona } from '../../prompts/projectPrompts';
import { aiGateway } from '../aiGateway';
import { resolveModelForSettings } from '../../catalog';

export async function generateLessonTabContent(
    courseTitle: string,
    lessonTitle: string,
    tabName: string,
    role: string,
    level: string,
    studentContext: StudentContext | null,
    settings: Settings,
    courseDescription?: string,
    courseContext?: string
): Promise<string> {
    const prompt = `
    ${buildLMSTutorPersona(settings)}

    ## Contenido a generar
    Curso: "${courseTitle}"
    ${courseDescription ? `Descripción del curso: ${courseDescription}` : ''}
    ${courseContext ? `Contexto específico del curso: ${courseContext}` : ''}
    Lección: "${lessonTitle}"
    Pestaña: "${tabName}"

    ## Calibración del estudiante
    (Úsalo SOLO para ajustar profundidad y terminología — NO para definir el escenario del contenido)
    - Rol: ${role}
    - Nivel: ${level}
    - Industria: ${studentContext?.industry || 'Seguros de Salud y Vida'}
    - Stack de referencia: ${studentContext?.techStack || 'No especificado'}
    - Proyecto actual del estudiante: ${studentContext?.currentProject || 'No especificado'} (contexto de referencia, no el tema del contenido)

    CRÍTICO: El contenido debe girar en torno al tema de la lección "${lessonTitle}" dentro del curso "${courseTitle}". El proyecto actual del estudiante es solo una referencia para calibrar profundidad técnica — NO lo uses como escenario principal del contenido generado.

    ## Instrucciones por pestaña

    Si la pestaña es "Resumen Ejecutivo":
    Genera un resumen ejecutivo estratégico dirigido a arquitectos de soluciones en el sector de seguros de salud y vida.
    Estructura: (1) Contexto Estratégico — qué problema de negocio asegurador aborda este tema, (2) Conceptos Arquitectónicos Clave — las ideas centrales y criterios de decisión del tema "${lessonTitle}", (3) Valor de Negocio — impacto concreto en la operación aseguradora (procesamiento de reclamaciones, ciclo de vida de pólizas, experiencia del asegurado, cumplimiento regulatorio), (4) Principios Clave — 3-5 principios aplicables de inmediato.
    Lenguaje ejecutivo: preciso, analítico, libre de jerga innecesaria.

    Si la pestaña es "Clase Magistral":
    Genera una clase magistral completa del tema "${lessonTitle}" siguiendo la estructura de cuatro momentos del Arquitecto-Profesor:
    **1. Contextualización Estratégica** — Presenta un problema real del sector asegurador que este tema específico resuelve. El escenario debe estar directamente relacionado con "${lessonTitle}", no con proyectos genéricos.
    **2. Análisis Arquitectónico** — Análisis técnico profundo del tema: dominios funcionales, patrones de integración relevantes, gobierno de APIs, modelos de datos, resiliencia, seguridad, cumplimiento. Incluye diagramas descritos en texto o pseudocódigo.
    **3. Discusión con los Estudiantes** — Formula 4-6 preguntas críticas que desafíen supuestos arquitectónicos relacionados con "${lessonTitle}" (ej: "¿Qué pasaría si el volumen de reclamaciones se triplica?", "¿Cómo impacta esta decisión en la experiencia del asegurado?").
    **4. Síntesis y Principios** — Resume 4-6 principios arquitectónicos derivados del análisis que los estudiantes puedan aplicar en sus organizaciones.
    Escribe con voz de profesor: riguroso, analítico, exigente pero cercano.

    Si la pestaña es "Visualización", genera SOLO sintaxis Mermaid válida (envuelta en \`\`\`mermaid) relevante para el tema "${lessonTitle}".
    Si la pestaña es "Evaluación (Quizzes)", genera un quiz interactivo de 3 a 5 preguntas de opción múltiple sobre decisiones arquitectónicas reales relacionadas con "${lessonTitle}". Devuelve SOLO un array JSON válido (sin markdown, sin texto adicional) con la forma: [{"question": "Enunciado de la pregunta", "options": ["Opción A", "Opción B", "Opción C", "Opción D"], "correctIndex": 0, "explanation": "Por qué la respuesta correcta lo es y por qué las demás no, conectado al contexto asegurador"}]. Cada pregunta debe tener exactamente 4 opciones y un único correctIndex (0-3).
    Si la pestaña es "Reto Práctico", describe un desafío práctico situado en una aseguradora, exigiendo que el estudiante justifique sus decisiones usando las tres dimensiones: impacto en negocio, viabilidad técnica, sostenibilidad operativa.
    Si la pestaña es "Conceptos Relacionados", genera conceptos relacionados con "${lessonTitle}". Devuelve SOLO un array JSON: [{"title": "...", "description": "..."}]. Sin markdown.
    Para cualquier otra pestaña, genera contenido Markdown completo, técnico y práctico, anclado en el tema específico de la lección.

    Asegúrate de que los datos, herramientas y patrones mencionados sean actuales y relevantes para el tema "${lessonTitle}" en el contexto de seguros de salud y vida.
    `;

    const modelName = resolveModelForSettings('default', settings).id;

    const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
        temperature: 0.7
    });
    return text;
}

export async function generateMasterclassContent(title: string, summary: string, settings: Settings): Promise<string> {
    const language = settings.language === 'es' ? 'Spanish' : 'English';
    const prompt = `
    You are a world-class Software Architecture Professor.
    Create a comprehensive "Masterclass" document in Markdown format about: "${title}".
    
    Topic Summary: "${summary}"

    Structure the class strictly as follows:
    
    # Masterclass: ${title}
    
    ## 1. Executive Summary
    Brief, high-impact definition.
    
    ## 2. Core Concepts (Deep Dive)
    Explain the mechanics, logic, and underlying principles. Use analogies if helpful.
    
    ## 3. Architecture Diagrams (Description)
    Describe conceptually what a diagram of this would look like.
    
    ## 4. Casos en la Industria Aseguradora
    Ejemplos reales del sector de seguros de salud y vida donde este concepto aplica directamente.
    
    ## 5. Strategic Pitfalls (Anti-patterns)
    What goes wrong? What are the common mistakes.
    
    ## 6. Key Takeaways
    Bullet points for the architect's pocket.
    
    Style: Academic, authoritative, yet highly readable. Use formatting (bolding, lists) generously.
    Language: ${language}.
    `;

    const modelName = resolveModelForSettings('default', settings).id;

    const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
        temperature: 0.7
    });
    return text || "Error generating content.";
}

export async function generateCategoryMasterclass(category: string, topics: {title: string, summary: string, content?: string}[], settings: Settings): Promise<string> {
    const language = settings.language === 'es' ? 'Spanish' : 'English';
    
    // Optimize: Use full content if available to leverage context window for deeper insights
    const topicsList = topics.map(t => `
### Topic: ${t.title}
Summary: ${t.summary}
${t.content ? `Key Details:\n${t.content.substring(0, 1500)}` : ''} 
    `).join('\n---\n');
    
    const prompt = `
    You are a distinguished Professor of Software Architecture.
    Your task is to create a COMPREHENSIVE GUIDE (Masterclass) for the entire category: "${category}".
    
    The guide must integrate and synthesize the knowledge from the following topics contained in this category.
    Use the detailed content provided to find connections, contrasts, and deep architectural insights.

    ${topicsList}

    Structure the document as a complete course module:

    # Module: ${category}

    ## 1. Module Overview
    Introduction to the category and why these concepts are fundamental for an architect.

    ## 2. Integrated Concepts (The Big Picture)
    Don't just list the topics. Explain how they relate to each other. For example, how does Topic A influence Topic B? Create a cohesive narrative.

    ## 3. Deep Dive by Topic
    (Go through the key topics provided, but group them logically if possible).
    For each major concept, provide:
    * Definition & Nuance (from the provided details)
    * Strategic Value
    * Real-world application

    ## 4. Architectural Patterns & Best Practices
    Synthesize the best practices relevant to this entire category.

    ## 5. Final Assessment / Checklist
    A summary checklist for an architect to ensure they have mastered this domain.

    Style: Comprehensive, academic but practical, authoritative. Use markdown for structure.
    Language: ${language}.
    `;

    const modelName = resolveModelForSettings('default', settings).id;

    const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
        temperature: 0.7
    });
    return text || "Error generating category masterclass.";
}

export async function chatWithLesson(
    courseTitle: string,
    lessonTitle: string,
    activeTab: string,
    message: string,
    history: { role: string, text: string }[],
    settings: Settings,
    lessonContent?: string,
    studentContext?: { industry?: string; techStack?: string; currentProject?: string },
): Promise<string> {
    // Ground the tutor in the exact material the student is reading so its
    // answers reference the lesson instead of generic theory. Truncated to
    // keep the prompt within budget — the most relevant context is the
    // opening of the section the student is currently viewing.
    const MAX_LESSON_CONTEXT_CHARS = 3500;
    const lessonExcerpt = (lessonContent || '').trim().slice(0, MAX_LESSON_CONTEXT_CHARS);
    const lessonContextBlock = lessonExcerpt
        ? `\n## Material que el estudiante está leyendo ahora (sección "${activeTab}")\n"""\n${lessonExcerpt}\n"""\nApóyate en este material concreto al responder; cita o referencia sus ideas en lugar de explicar teoría genérica.`
        : '';

    const calibrationBlock = studentContext && (studentContext.industry || studentContext.techStack || studentContext.currentProject)
        ? `\n## Calibración del estudiante (úsala solo para ajustar profundidad y ejemplos)\n- Industria: ${studentContext.industry || 'No especificada'}\n- Stack de referencia: ${studentContext.techStack || 'No especificado'}\n- Proyecto actual: ${studentContext.currentProject || 'No especificado'}`
        : '';

    const prompt = `
    ${buildLMSTutorPersona(settings)}

    You are guiding a student through the "${activeTab}" section of the lesson "${lessonTitle}" from the course "${courseTitle}".
    Respond as the Architect-Professor: precise, analytical, and grounded in real insurance industry scenarios.
    When answering doubts, connect concepts to concrete problems an insurer faces — avoid abstract explanations.
    Be demanding of rigor but approachable; if the student's question is vague, help them reformulate it with more precision.
    Favor a Socratic style: when the student is reasoning through a problem, guide with a sharp question or a hint before handing over the full answer, so they build the decision criteria themselves. Still give a complete answer when they explicitly ask for one or are clearly stuck.
    Maintain continuity with the previous conversation: do not repeat yourself, and build on what was already discussed.
    Keep answers focused and actionable. Reply in the same language the student writes in (default Spanish).
    ${lessonContextBlock}
    ${calibrationBlock}
    `;

    const modelName = resolveModelForSettings('default', settings).id;

    const historyText = history.map(h => `${h.role === 'user' ? 'User' : 'Tutor'}: ${h.text}`).join('\n\n');
    const fullMessage = historyText ? `Previous Conversation:\n${historyText}\n\nUser: ${message}` : message;

    // Route the tutor chat through the model-fallback pipeline (history is
    // folded into the prompt so context survives a model switch), same as
    // chatWithProject — a 429 on the preferred model falls back instead of
    // breaking the lesson tutor.
    const { text } = await aiGateway.generateContent(
        settings,
        modelName,
        fullMessage,
        {
            systemInstruction: prompt,
            temperature: settings.aiConfig?.temperature ?? 0.7
        },
        { maxRetries: 1 },
    );
    return text;
}
