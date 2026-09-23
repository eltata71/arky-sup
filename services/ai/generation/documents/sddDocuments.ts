/**
 * The two SDD documents a project asks for: the process plan (what to specify,
 * in what order) and the health report (how complete and consistent what is
 * specified already is). Moved out of the engine in F5-01 (corte 5); the
 * prompts are unchanged.
 */
import type { Settings } from '../../../../types';
import type { Project } from '../../../architectureProjects';
import { resolveModelForSettings } from '../../catalog';
import { buildArtifactsContext, buildBasePrompt } from '../../prompts/projectPrompts';
import { aiGateway } from '../aiGateway';

/**
 * Generates a full SDD process plan tailored to the project context.
 * Returns a structured Markdown document describing all 5 SDD phases
 * with artifact recommendations, priorities, and sequencing.
 */
export async function generateSDDProcessPlan(project: Project, settings: Settings): Promise<string> {
    const basePrompt = buildBasePrompt(project, settings);
    const artifactsContext = buildArtifactsContext(project);
    const modelName = resolveModelForSettings('default', settings).id;

    const prompt = `
${basePrompt}
${artifactsContext}

You are a senior SDD (Specification-Driven Development) architect. Generate a tailored SDD process plan for this project.

The plan must cover all 5 SDD phases with specific recommendations based on the project domain, existing artifacts, and gaps.

Output a comprehensive Markdown document with this structure:

# Plan SDD — ${project.name}

## Executive Summary
[2-3 sentences on why SDD is critical for this project and what the plan achieves]

## SDD Maturity Assessment
[Assess current state: what specifications exist, what is missing, overall SDD readiness score 0-100]

## Phase 1: Requirements Specification
### Status: [Complete/Partial/Missing]
### Required Artifacts:
- BRD (Business Requirements Document) — [status and priority]
- Use Case Specifications — [status and priority]
- User Story Map — [status and priority]
### Recommended Next Steps:
[Specific actions for this project]

## Phase 2: Architecture Specification
### Status: [Complete/Partial/Missing]
### Required Artifacts:
- Domain Model DDD — [status and priority]
- Event Storming — [status and priority]
- Ubiquitous Language Glossary — [status and priority]
- Architecture Decision Records (ADR) — [status and priority]
### Recommended Next Steps:

## Phase 3: Component Specification
### Status: [Complete/Partial/Missing]
### Required Artifacts:
- OpenAPI Contract — [status and priority]
- Component Specifications — [status and priority]
- Database Schema — [status and priority]
### Recommended Next Steps:

## Phase 4: Quality Specification
### Status: [Complete/Partial/Missing]
### Required Artifacts:
- NFR Specification (ISO 25010) — [status and priority]
- BDD Scenarios (Gherkin) — [status and priority]
- Test Plan — [status and priority]
### Recommended Next Steps:

## Phase 5: Deployment Specification
### Status: [Complete/Partial/Missing]
### Required Artifacts:
- Infrastructure Specification — [status and priority]
- CI/CD Pipeline — [status and priority]
### Recommended Next Steps:

## Traceability Overview
- Requirements Traceability Matrix status
- Coverage gaps identified

## Recommended Generation Order
[Numbered list of which artifacts to generate first, with rationale based on dependencies]

## SDD Compliance Checklist
[Checkbox list of all SDD requirements for this project]

Be specific to the project domain. Reference existing artifacts by name where applicable.
`;

    const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
        temperature: 0.5
    });
    return text;
}

/**
 * Analyzes a set of SDD artifacts to assess their completeness and
 * cross-artifact consistency from a specification perspective.
 * Returns an SDD health report in Markdown.
 */
export async function generateSDDHealthReport(project: Project, settings: Settings): Promise<string> {
    const basePrompt = buildBasePrompt(project, settings);
    const artifactsContext = buildArtifactsContext(project);
    const modelName = resolveModelForSettings('default', settings).id;

    const sddArtifacts = project.artifacts.filter(a => a.type.startsWith('sdd-'));
    const sddArtifactNames = sddArtifacts.map(a => a.name).join(', ') || 'None yet';

    const prompt = `
${basePrompt}
${artifactsContext}

You are an SDD Quality Auditor. Analyze the project's SDD artifacts and produce a health report.

Current SDD artifacts: ${sddArtifactNames}

Generate a Markdown health report:

# SDD Health Report — ${project.name}

## Overall SDD Score: [X/100]

## Completeness Analysis
| SDD Phase | Required Artifacts | Present | Missing | Score |
|-----------|-------------------|---------|---------|-------|
| Phase 1: Requirements | BRD, Use Cases, User Stories | X | X | X% |
| Phase 2: Architecture | Domain Model, Event Storming, Glossary | X | X | X% |
| Phase 3: Components | API Spec, DB Schema, Component Specs | X | X | X% |
| Phase 4: Quality | NFR, BDD Scenarios, Test Plan | X | X | X% |
| Phase 5: Deployment | Infra Spec, CI/CD | X | X | X% |

## Cross-Artifact Consistency
[Identify any conflicts, gaps, or inconsistencies between existing specifications]

## Traceability Coverage
[Assess how well requirements are traced through to architecture and tests]

## Critical Missing Specifications
[List top 3 most critical missing specs with business impact explanation]

## Recommended Immediate Actions
[3-5 concrete next steps prioritized by impact]

## SDD Compliance Status
[Pass/Fail for each SDD principle]
`;

    const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
        temperature: 0.4
    });
    return text;
}
