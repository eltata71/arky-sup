/**
 * Unit tests for the Task-9 provider-selection logic in SettingsPage.
 *
 * A full component render of `SettingsPage` is impractical here — it depends on
 * `useAppContext` (which pulls in Auth, Firestore and the Router) plus many
 * sibling components and the Gemini/OpenRouter model services. Rendering it in
 * isolation would require a heavyweight mock harness and would produce brittle
 * DOM assertions. Instead we unit-test the exported pure helper that encodes
 * the one behaviour that matters and is easy to get wrong: when the user
 * switches the AI provider, the persisted `aiConfig.model` must belong to the
 * *new* provider's catalog, so the Task-8 routing never forwards a Gemini id to
 * OpenRouter (which would 404) or an OpenRouter id back to Gemini.
 */
import { describe, it, expect } from 'vitest';
import { resolveModelForProviderSwitch } from '../../pages/SettingsPage';
import { DEFAULT_TEXT_MODEL } from '../../lib/ai/modelCatalog';

const OPENROUTER_DEFAULT_MODEL = 'openrouter/auto';

describe('resolveModelForProviderSwitch (Task 9 provider -> model mapping)', () => {
  it('defaults to openrouter/auto when switching to openrouter from an unset provider', () => {
    // provider currently undefined (legacy install) -> switching to openrouter
    const model = resolveModelForProviderSwitch(
      'provider',
      'openrouter',
      undefined,
    );
    expect(model).toBe(OPENROUTER_DEFAULT_MODEL);
  });

  it('defaults to openrouter/auto when switching from gemini to openrouter', () => {
    const model = resolveModelForProviderSwitch(
      'provider',
      'openrouter',
      'gemini',
    );
    expect(model).toBe(OPENROUTER_DEFAULT_MODEL);
  });

  it('resets to the Gemini default when switching back from openrouter to gemini', () => {
    const model = resolveModelForProviderSwitch(
      'provider',
      'gemini',
      'openrouter',
    );
    expect(model).toBe(DEFAULT_TEXT_MODEL);
  });

  it('does not clobber an already-valid model when re-selecting the same provider', () => {
    // Already on openrouter with a valid openrouter model -> keep it unchanged
    const model = resolveModelForProviderSwitch(
      'provider',
      'openrouter',
      'openrouter',
    );
    expect(model).toBeUndefined();

    // Already on gemini -> keep the current model unchanged
    const geminiModel = resolveModelForProviderSwitch(
      'provider',
      'gemini',
      'gemini',
    );
    expect(geminiModel).toBeUndefined();
  });

  it('leaves the model untouched for any non-provider field', () => {
    expect(resolveModelForProviderSwitch('temperature', 0.5, 'gemini')).toBeUndefined();
    expect(resolveModelForProviderSwitch('model', 'some/model', 'gemini')).toBeUndefined();
  });
});
