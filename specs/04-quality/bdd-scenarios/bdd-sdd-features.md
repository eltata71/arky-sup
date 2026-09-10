---
artifact_id: 04-QUAL-BDD
version: 1.0.0
status: Approved
created: 2026-04-13
project: Arky 10 (arkypro-1.0)
standard: Gherkin / BDD
generated_by: Claude Code · SDD Architect
---

# BDD Scenarios — Gherkin Specification
## Extensión SDD de Arky 10

---

## Overview

Los siguientes escenarios BDD cubren las funcionalidades principales de la extensión SDD. Están escritos desde la perspectiva del arquitecto de soluciones como usuario primario.

---

```gherkin
Feature: Generación de Artefactos SDD
  As a solutions architect
  I want to generate SDD artifacts for my project
  So that I have complete specifications before implementation starts

  Background:
    Given I am logged in to Arky 10
    And I have an active project "Gestión de Reclamos Médicos"
    And I am on the Project Hub screen

  Scenario: Acceder al dashboard SDD desde el hub del proyecto
    Given I see the project hub with the "Proceso SDD" button
    When I click the "Proceso SDD" button
    Then I should be navigated to "/sdd-process/[projectId]"
    And I should see the SDD Process dashboard
    And I should see 5 SDD phases in the sidebar
    And I should see an overall SDD completion percentage of 0%

  Scenario: Generar un BRD desde el dashboard SDD
    Given I am on the SDD Process dashboard
    And Phase 1: Requirements is selected
    And "BRD — Documento de Requisitos de Negocio" shows as missing
    When I click "Generar" on the BRD artifact
    Then I should see a loading state "Generando..."
    And the system should call geminiService.generateArtifactContent with type "sdd-brd"
    And after generation the artifact should appear as "present" with a green checkmark
    And the Phase 1 completion percentage should increase

  Scenario: Visualizar un artefacto SDD generado en el workspace
    Given I have generated a BRD artifact
    And it shows as "present" in the SDD dashboard
    When I click "Abrir" on the BRD artifact
    Then I should be navigated to "/workspace/[projectId]?artifact=[artifactId]"
    And I should see the BRD content rendered as a document
    And the document should contain sections from IEEE 830 format

  Scenario: Generar artefacto híbrido (Domain Model DDD)
    Given I am on Phase 2: Architecture in the SDD dashboard
    When I click "Generar" on "Modelo de Dominio DDD"
    Then the AI should generate content with representation "hybrid"
    And the content should include a Mermaid diagram block
    And the artifact should be viewable in both document and diagram mode
```

---

```gherkin
Feature: Plan SDD con AI
  As a solutions architect
  I want to get an AI-generated SDD plan for my project
  So that I know exactly which artifacts to create and in what order

  Background:
    Given I am on the SDD Process dashboard for an existing project
    And the project has some existing artifacts

  Scenario: Generar Plan SDD desde el sidebar
    Given I see the "Generar Plan SDD" button in the sidebar
    When I click "Generar Plan SDD"
    Then the active tab should switch to "Plan SDD"
    And I should see a loading state "Generando plan SDD personalizado..."
    And after generation I should see a Markdown document with:
      | Section | Expected Content |
      | Executive Summary | Project-specific summary |
      | SDD Maturity Assessment | Score 0-100 based on existing artifacts |
      | Phase 1: Requirements | Status and artifact recommendations |
      | Phase 2: Architecture | Status and artifact recommendations |
      | Recommended Generation Order | Numbered list of artifacts to create |

  Scenario: Generar Reporte de Salud SDD
    Given I see the "Reporte de Salud" button in the sidebar
    When I click "Reporte de Salud"
    Then the active tab should switch to "Reporte de Salud"
    And after generation I should see a health report including:
      | Section | Expected Content |
      | Overall SDD Score | Percentage 0-100 |
      | Completeness Analysis | Table with all 5 phases |
      | Critical Missing Specifications | Top 3 missing specs |
      | Recommended Immediate Actions | 3-5 concrete next steps |
```

---

```gherkin
Feature: Tipos de Artefacto SDD en el Catálogo
  As a solutions architect
  I want to see SDD artifact templates in the artifact catalog
  So that I can create them from the standard project workflow

  Background:
    Given I am on the Project Hub
    And I am viewing the "Catálogo & Creación" tab

  Scenario: Ver plantillas SDD en el catálogo
    Given the artifact catalog is displayed
    When I filter by "Vista SDD"
    Then I should see 9 SDD artifact templates:
      | Template Name |
      | BRD — Documento de Requisitos de Negocio |
      | Especificación de Casos de Uso |
      | User Story Map — Mapa de Historias de Usuario |
      | Modelo de Dominio DDD |
      | Event Storming — Mapa de Eventos de Dominio |
      | Glosario — Lenguaje Ubicuo (Ubiquitous Language) |
      | NFR — Requisitos No Funcionales (ISO 25010) |
      | Escenarios BDD — Gherkin (Given/When/Then) |
      | Matriz de Trazabilidad de Requisitos |

  Scenario: Generar artefacto SDD desde el catálogo estándar
    Given I see the "BRD — Documento de Requisitos de Negocio" template
    When I click "Generar" on this template
    Then the system should use the IEEE 830 prompt format
    And the generated content should have multiple structured sections
    And the artifact should be saved with type "sdd-brd"
    And architecturalView should be "Vista SDD"

  Scenario: Columna Kanban SDD en vista tablero
    Given I switch to the Kanban/Board view
    Then I should see a column "SDD: Especificación"
    And SDD artifacts should appear in this column
    And existing artifacts should remain in their original columns
```

---

```gherkin
Feature: Visualización de Artefactos SDD en ArtifactCanvas
  As a solutions architect
  I want to see SDD artifacts rendered correctly in the canvas
  So that I can review and edit specifications effectively

  Background:
    Given I have generated an SDD artifact
    And I am viewing it in ArtifactCanvas

  Scenario: Artefactos documento se renderizan como Markdown
    Given the artifact has representation "document"
    And the artifact type starts with "sdd-"
    Then the artifact should display in document view by default
    And the content should be rendered as formatted HTML from Markdown
    And no diagram view toggle should be needed

  Scenario: Artefactos híbridos muestran texto y diagrama
    Given the artifact is "Modelo de Dominio DDD" with representation "hybrid"
    When I view the artifact
    Then I should see the Markdown analysis text
    And I should see a Mermaid diagram rendered visually
    And I should be able to toggle between document and diagram views

  Scenario: Artefacto BDD muestra código Gherkin resaltado
    Given the artifact is "Escenarios BDD — Gherkin"
    When I view the document
    Then the Gherkin code blocks should be visible within code fences
    And the content should be readable as structured specification
```
