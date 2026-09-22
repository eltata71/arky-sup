import React, { useMemo, useState } from 'react';
import { Badge, Button } from '../ui';
import type { Artifact } from '../../lib/artifacts';
import {
  publicationStatusLabel,
  suggestPackageArtifacts,
  type CreatePublicationPackageInput,
  type PublicationPackage,
  type PublicationProfile,
} from '../../services/publicationPipeline';
import { statusTone } from './publicationUi';

interface PublicationPackagePanelProps {
  packages: PublicationPackage[];
  profiles: PublicationProfile[];
  artifacts: Artifact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (input: Omit<CreatePublicationPackageInput, 'projectId'>) => void;
}

/** Latest artifact per version group. */
const latestArtifacts = (artifacts: Artifact[]): Artifact[] => {
  const map = new Map<string, Artifact>();
  for (const artifact of artifacts) {
    const current = map.get(artifact.versionGroupId);
    if (!current || artifact.version > current.version) map.set(artifact.versionGroupId, artifact);
  }
  return Array.from(map.values());
};

/**
 * Package list + creation form. Lets the user create a package from a profile
 * (with a suggested artifact set) or from a manual artifact selection.
 */
export const PublicationPackagePanel: React.FC<PublicationPackagePanelProps> = ({
  packages, profiles, artifacts, selectedId, onSelect, onCreate,
}) => {
  const [creating, setCreating] = useState(packages.length === 0);
  const [name, setName] = useState('');
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? '');
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<Set<string>>(new Set());

  const latest = useMemo(() => latestArtifacts(artifacts), [artifacts]);
  const activeProfile = profiles.find((p) => p.id === profileId);

  const applySuggestion = (): void => {
    if (!activeProfile) return;
    setSelectedArtifactIds(new Set(suggestPackageArtifacts(activeProfile, latest)));
  };

  const toggleArtifact = (id: string): void => {
    setSelectedArtifactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = (): void => {
    if (!profileId) return;
    onCreate({
      name: name.trim() || `Paquete ${activeProfile?.name ?? ''}`.trim(),
      profileId,
      artifactIds: Array.from(selectedArtifactIds),
    });
    setName('');
    setSelectedArtifactIds(new Set());
    setCreating(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-white/10">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">Paquetes</h2>
        <Button variant="ghost" size="sm" onClick={() => setCreating((v) => !v)}
          aria-label={creating ? 'Cerrar el formulario de creación' : 'Crear un nuevo paquete'}>
          {creating ? 'Cerrar' : '+ Nuevo'}
        </Button>
      </div>

      {creating && (
        <div className="space-y-2 border-b border-slate-200 p-3 dark:border-white/10">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Nombre</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-white/15 dark:bg-white/[0.04] dark:text-white"
              placeholder="Paquete de publicación"
              aria-label="Paquete de publicación"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Perfil de publicación</span>
            <select
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-white/15 dark:bg-white/[0.04] dark:text-white"
              aria-label="Perfil de publicación"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          {activeProfile && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{activeProfile.description}</p>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Artefactos ({selectedArtifactIds.size})
            </span>
            <button
              type="button"
              onClick={applySuggestion}
              className="text-xs font-bold text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-300"
            >
              Sugerir por perfil
            </button>
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1.5 dark:border-white/10">
            {latest.length === 0 && (
              <p className="px-1 py-2 text-xs text-slate-500 dark:text-slate-400">
                El proyecto no tiene artefactos todavía.
              </p>
            )}
            {latest.map((a) => (
              <label key={a.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.04]">
                <input
                  type="checkbox"
                  checked={selectedArtifactIds.has(a.id)}
                  onChange={() => toggleArtifact(a.id)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500"
                />
                <span className="truncate">{a.name}</span>
              </label>
            ))}
          </div>
          <Button variant="primary" size="sm" onClick={submit} disabled={!profileId}
            aria-label="Crear el paquete">
            Crear paquete
          </Button>
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {packages.length === 0 && !creating && (
          <li className="px-2 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Aún no hay paquetes. Crea el primero para empezar a publicar.
          </li>
        )}
        {packages.map((pkg) => (
          <li key={pkg.id}>
            <button
              type="button"
              onClick={() => onSelect(pkg.id)}
              aria-current={pkg.id === selectedId}
              className={
                pkg.id === selectedId
                  ? 'mb-1 w-full rounded-xl border border-primary-300 bg-primary-50 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-primary-500/40 dark:bg-primary-500/10'
                  : 'mb-1 w-full rounded-xl border border-transparent px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-white/[0.04]'
              }
            >
              <span className="block truncate text-sm font-semibold text-slate-900 dark:text-white">
                {pkg.name}
              </span>
              <span className="mt-1 flex items-center gap-1.5">
                <Badge tone={statusTone(pkg.status)} size="xs">{publicationStatusLabel(pkg.status)}</Badge>
                <Badge tone="gray" size="xs" outline>v{pkg.version}</Badge>
                {pkg.freshness !== 'current' && <Badge tone="warning" size="xs">drift</Badge>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
