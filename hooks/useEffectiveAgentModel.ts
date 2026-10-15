import { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { resolveTierModelId } from '../services/ai/generation/tierModelResolver';
import type { ModelTier } from '../lib/ai/modelCatalog';

/** Loads the provider catalog only while an agent's profile is open. */
export function useEffectiveAgentModel(tier: ModelTier): string | null | undefined {
  const { settings } = useAppContext();
  const [model, setModel] = useState<string | null | undefined>(undefined);
  const provider = settings.aiConfig?.provider;
  const requested = settings.aiConfig?.model;

  useEffect(() => {
    let current = true;
    setModel(undefined);
    void resolveTierModelId(tier, settings)
      .then((id) => {
        if (current) setModel(id);
      })
      .catch(() => {
        if (current) setModel(null);
      });
    return () => { current = false; };
  }, [tier, provider, requested, settings]);

  return model;
}
