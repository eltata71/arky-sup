import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { Project } from '../../services/architectureProjects';
import type { ArtifactGenerationContract } from '../../services/artifacts/domain/artifactGenerationContract';
import { buildDeterministicArtifactBrief } from '../../services/artifacts/domain/artifactBriefService';
import { buildArtifactRecommendationCandidates } from '../../services/artifacts/domain/artifactRecommendationService';
import { CustomArtifactBriefWizard } from '../../components/CustomArtifactBriefWizard';

const project: Project = {
  id: 'p1',
  name: 'Core',
  description: 'Core con APIs y eventos.',
  projectContext: ['API Gateway es contexto principal.'],
  artifacts: [{
    id: 'a1',
    versionGroupId: 'a1',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    name: 'Inventario APIs',
    type: 'markdown',
    phase: 'General',
    architecturalView: 'Vista Lógica y de Diseño',
    content: 'APIs y eventos del core.',
    objective: 'Inventario de APIs y eventos.',
    keyConcepts: [],
    representation: 'document',
  }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const Harness: React.FC<{ onGenerate?: () => void }> = ({ onGenerate = vi.fn() }) => {
  const [contract, setContract] = useState<ArtifactGenerationContract>(() => buildDeterministicArtifactBrief(
    project,
    'Necesito un diagrama de integración API para explicar eventos al equipo técnico.',
    { now: '2026-05-18T00:00:00.000Z' },
  ));
  const candidates = buildArtifactRecommendationCandidates(project, contract, 3);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | undefined>(candidates[0]?.id);
  return (
    <CustomArtifactBriefWizard
      project={project}
      contract={contract}
      candidates={candidates}
      selectedCandidateId={selectedCandidateId}
      showTop3
      isAnalyzing={false}
      isGenerating={false}
      onContractChange={next => setContract(next)}
      onBuildRecommendations={vi.fn()}
      onSelectCandidate={candidate => setSelectedCandidateId(candidate.id)}
      onGenerate={onGenerate}
      onBackToIdea={vi.fn()}
    />
  );
};

describe('CustomArtifactBriefWizard', () => {
  it('permite editar audiencia, propósito, familia y nivel de detalle', () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText(/Audiencia/i), { target: { value: 'executive' } });
    fireEvent.change(screen.getByLabelText(/Familia esperada/i), { target: { value: 'document' } });
    fireEvent.change(screen.getByLabelText(/Propósito/i), { target: { value: 'decision' } });
    fireEvent.change(screen.getByLabelText(/Nivel de detalle/i), { target: { value: 'executive' } });

    expect(screen.getByLabelText(/Audiencia/i)).toHaveValue('executive');
    expect(screen.getByLabelText(/Familia esperada/i)).toHaveValue('document');
    expect(screen.getByLabelText(/Propósito/i)).toHaveValue('decision');
    expect(screen.getByLabelText(/Nivel de detalle/i)).toHaveValue('executive');
  });

  it('conserva datos al navegar entre pasos y dispara generación sin romper onGenerate', () => {
    const onGenerate = vi.fn();
    render(<Harness onGenerate={onGenerate} />);

    fireEvent.change(screen.getByLabelText(/Audiencia/i), { target: { value: 'executive' } });
    fireEvent.click(screen.getByRole('button', { name: /Continuar a fuentes/i }));
    fireEvent.change(screen.getByLabelText(/Uso de fuente Inventario APIs/i), { target: { value: 'required' } });
    fireEvent.click(screen.getByRole('button', { name: /Construir recomendaciones/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar selección/i }));

    expect(screen.getByText(/Fuentes seleccionadas/i).nextSibling?.textContent).toBe('1');
    // The confirmation summary renders the localized audience label, while the
    // underlying enum value remains `executive` (preserved in the contract).
    expect(screen.getAllByText(/^Audiencia$/i)[0].nextSibling?.textContent).toBe('Ejecutiva');

    fireEvent.click(screen.getByRole('button', { name: /Generar con contrato/i }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('#30 numera los pasos de forma natural empezando por "1 · Idea"', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /1 · Idea/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2 · Brief/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /5 · Confirmación/i })).toBeInTheDocument();
  });

  it('muestra el filtro de fuentes cuando hay 6 o más artefactos y filtra por nombre', () => {
    const manyArtifacts = Array.from({ length: 7 }).map((_, index) => ({
      id: `a-${index}`,
      versionGroupId: `a-${index}`,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      name: index === 3 ? 'Diagrama de Contexto C4' : `Fuente Genérica ${index}`,
      type: 'markdown' as const,
      phase: 'General',
      architecturalView: 'Vista Lógica y de Diseño' as const,
      content: '',
      objective: index === 3 ? 'Diagrama de contexto para el sistema.' : `Objetivo de la fuente ${index}.`,
      keyConcepts: [],
      representation: 'document' as const,
    }));
    const projectWithMany: Project = { ...project, artifacts: manyArtifacts };
    const contract = buildDeterministicArtifactBrief(
      projectWithMany,
      'Necesito un diagrama de integración API para explicar eventos al equipo técnico.',
      { now: '2026-05-18T00:00:00.000Z' },
    );
    render(
      <CustomArtifactBriefWizard
        project={projectWithMany}
        contract={contract}
        candidates={[]}
        showTop3
        isAnalyzing={false}
        isGenerating={false}
        onContractChange={vi.fn()}
        onBuildRecommendations={vi.fn()}
        onSelectCandidate={vi.fn()}
        onGenerate={vi.fn()}
        onBackToIdea={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Continuar a fuentes/i }));
    const filterInput = screen.getByPlaceholderText(/Filtrar por nombre/i);
    expect(filterInput).toBeInTheDocument();
    expect(screen.getByText(/Mostrando 7 fuentes/i)).toBeInTheDocument();

    fireEvent.change(filterInput, { target: { value: 'Contexto C4' } });
    expect(screen.getByText(/Mostrando 1 de 7 fuentes/i)).toBeInTheDocument();
    expect(screen.getByText(/Diagrama de Contexto C4/i)).toBeInTheDocument();
    expect(screen.queryByText(/Fuente Genérica 0/i)).not.toBeInTheDocument();

    // Clear button resets the filter.
    fireEvent.click(screen.getByRole('button', { name: /Limpiar filtro de fuentes/i }));
    expect(screen.getByText(/Mostrando 7 fuentes/i)).toBeInTheDocument();
  });

  it('oculta el filtro de fuentes cuando hay menos de 6 artefactos', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Continuar a fuentes/i }));
    expect(screen.queryByPlaceholderText(/Filtrar por nombre/i)).not.toBeInTheDocument();
  });

  it('muestra la idea original colapsada en el paso 2', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /Ver idea original/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    // The blockquote wraps the original request in literal curly quotes —
    // unique to the disclosure so it doesn't collide with the normalizedIntent
    // textarea.
    expect(screen.getByText(/“Necesito un diagrama de integración API/i)).toBeInTheDocument();
  });

  it('el chip "1 · Idea" vuelve a la idea inicial', () => {
    const onBackToIdea = vi.fn();
    render(
      <CustomArtifactBriefWizard
        project={project}
        contract={buildDeterministicArtifactBrief(project, 'Diagrama de integración API para el equipo técnico.', { now: '2026-05-18T00:00:00.000Z' })}
        candidates={[]}
        showTop3
        isAnalyzing={false}
        isGenerating={false}
        briefSource="ai-assisted"
        briefWarnings={['Una fuente fue mapeada a la versión más reciente.']}
        onContractChange={vi.fn()}
        onBuildRecommendations={vi.fn()}
        onSelectCandidate={vi.fn()}
        onGenerate={vi.fn()}
        onBackToIdea={onBackToIdea}
      />,
    );
    expect(screen.getByText(/Brief asistido por IA/i)).toBeInTheDocument();
    expect(screen.getByText(/Avisos del brief/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /1 · Idea/i }));
    expect(onBackToIdea).toHaveBeenCalledTimes(1);
  });
});
