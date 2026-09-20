# Componentes fuertemente conexos — línea base 2026-09-20 (fd590e7)

Tarjan sobre el mismo grafo de aristas que produce `scripts/checkModuleBoundaries.mjs :: analyse()`.

```
NODES: 34
SCCs with >1 module: 2
  [9] services (raíz), services/agent, services/ai, services/architectureKnowledgeGraph, services/architectureOffice, services/architectureProjects, services/artifacts, services/chat, services/publicationPipeline
  [3] components, context, hooks
```

## Aristas internas del componente de dominio

```
  1 services (raíz) -> services/agent    e.g. services/geminiService.ts → services/agent/agentContextComposer
 16 services (raíz) -> services/ai    e.g. services/geminiService.ts → services/ai/providers/gemini/geminiClient
  1 services (raíz) -> services/architectureKnowledgeGraph    e.g. services/geminiService.ts → services/architectureKnowledgeGraph
  3 services (raíz) -> services/architectureOffice    e.g. services/geminiService.ts → services/architectureOffice/officeAgentPersonas
  4 services (raíz) -> services/artifacts    e.g. services/geminiService.ts → services/artifacts/deterministicArtifactFallbacks
  1 services (raíz) -> services/chat    e.g. services/geminiService.ts → services/chat
  3 services/agent -> services/ai    e.g. services/agent/agentExecutor.ts → services/ai
  4 services/agent -> services/chat    e.g. services/agent/agentContextComposer.ts → services/chat
 12 services/ai -> services (raíz)    e.g. services/ai/artifactSuggestionService.ts → services/geminiService
  1 services/architectureKnowledgeGraph -> services/architectureOffice    e.g. services/architectureKnowledgeGraph/ArchitectureKnowledgeGraphService.ts → services/architectureOffice/officeArchitectureKnowledge
  2 services/architectureOffice -> services/agent    e.g. services/architectureOffice/OfficeRunnerAdapters.ts → services/agent
  2 services/architectureOffice -> services/ai    e.g. services/architectureOffice/OfficeEngagementPlanner.ts → services/ai/structuredOutput
  1 services/architectureOffice -> services/publicationPipeline    e.g. services/architectureOffice/officePublicationBridge.ts → services/publicationPipeline/PublicationPipelineTypes
  4 services/architectureProjects -> services/architectureKnowledgeGraph    e.g. services/architectureProjects/projectDocumentMapper.ts → services/architectureKnowledgeGraph
  2 services/architectureProjects -> services/architectureOffice    e.g. services/architectureProjects/projectDocumentMapper.ts → services/architectureOffice/officeShared
  1 services/architectureProjects -> services/chat    e.g. services/architectureProjects/projectWrites.ts → services/chat/ChatHistoryRepository
  3 services/architectureProjects -> services/publicationPipeline    e.g. services/architectureProjects/projectDocumentMapper.ts → services/publicationPipeline/PublicationPipelineTypes
  3 services/artifacts -> services/ai    e.g. services/artifacts/application/artifactAssessment.ts → services/ai/artifactSuggestionService
  2 services/artifacts -> services/architectureKnowledgeGraph    e.g. services/artifacts/artifactGenerationRun.ts → services/architectureKnowledgeGraph
  1 services/artifacts -> services/architectureProjects    e.g. services/artifacts/artifactPersistence.ts → services/architectureProjects
  1 services/chat -> services/ai    e.g. services/chat/chatCompactor.ts → services/ai
  7 services/publicationPipeline -> services/architectureKnowledgeGraph    e.g. services/publicationPipeline/PublicationPreflightService.ts → services/architectureKnowledgeGraph
total inner edges: 22
```
