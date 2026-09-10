import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { Settings, AIConfig } from '../types';
import { DocumentTextIcon, PaintBrushIcon, LanguageIcon, SunIcon, MoonIcon, PlusCircleIcon, TrashIcon, CpuChipIcon, ArrowLeftIcon } from '../components/Icons';
import { DEFAULT_TEXT_MODEL, listCurrentGeminiModels, listModelsForProvider } from '../services/ai';
import type { AIModelOption, GeminiModelOption } from '../services/ai';
import { Button, Card, Input, Badge, CardEyebrow } from '../components/ui';
import { AccountPanel } from '../components/account/AccountPanel';

type Tab = 'context' | 'appearance' | 'ai' | 'account';

// Default model used when the user switches the provider to OpenRouter. Must be
// an id OpenRouter recognises ('openrouter/auto' routes to the best model) so
// the Task-8 routing never forwards a Gemini id to OpenRouter and hits a 404.
const OPENROUTER_DEFAULT_MODEL = 'openrouter/auto';

/**
 * When the user switches the active AI provider, the persisted `aiConfig.model`
 * must belong to the newly selected provider's catalog. Switching to openrouter
 * defaults to `openrouter/auto`; switching back to gemini resets to the Gemini
 * default. Returns `undefined` when no model change is required.
 */
export function resolveModelForProviderSwitch(
  field: keyof AIConfig,
  value: string | number | boolean,
  currentProvider: AIConfig['provider'] | undefined,
): string | undefined {
  if (field !== 'provider') return undefined;
  if (value === 'openrouter' && currentProvider !== 'openrouter') return OPENROUTER_DEFAULT_MODEL;
  if (value === 'gemini' && currentProvider !== 'gemini') return DEFAULT_TEXT_MODEL;
  return undefined;
}

const TabButton: React.FC<{
  label: string;
  isActive: boolean;
  onClick: () => void;
}> = ({ label, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 text-sm font-medium rounded-md ${isActive ? 'bg-primary-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
  >
    {label}
  </button>
);

const SettingsPage: React.FC = () => {
  const { settings, updateSettings, t, projects, deleteProject } = useAppContext();
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [activeTab, setActiveTab] = useState<Tab>('ai');
  const [isSaving, setIsSaving] = useState(false);
  const [userApiKey, setUserApiKey] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [availableModels, setAvailableModels] = useState<GeminiModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelRefreshTick, setModelRefreshTick] = useState(0);
  const [userOpenRouterApiKey, setUserOpenRouterApiKey] = useState('');
  const [availableOpenRouterModels, setAvailableOpenRouterModels] = useState<AIModelOption[]>([]);
  const [isLoadingOpenRouterModels, setIsLoadingOpenRouterModels] = useState(false);
  const [openRouterModelsError, setOpenRouterModelsError] = useState('');
  const [openRouterKeyTick, setOpenRouterKeyTick] = useState(0);
  const navigate = useNavigate();

  // Load User API Key from LocalStorage on mount
  useEffect(() => {
      const storedKey = localStorage.getItem('user_gemini_key');
      if (storedKey) setUserApiKey(storedKey);
  }, []);

  // Load OpenRouter User API Key from LocalStorage on mount
  useEffect(() => {
      const storedKey = localStorage.getItem('user_openrouter_key');
      if (storedKey) setUserOpenRouterApiKey(storedKey);
  }, []);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  // The model list is refetched when the key *source* changes, not on every
  // keystroke in the settings form — so the effect reads the latest settings
  // through a ref instead of depending on the whole object.
  const localSettingsRef = useRef(localSettings);
  localSettingsRef.current = localSettings;

  useEffect(() => {
    const loadModels = async () => {
      setIsLoadingModels(true);
      setModelsError('');
      try {
        const models = await listCurrentGeminiModels(localSettingsRef.current);
        setAvailableModels(models);
      } catch (error) {
        console.error('Error loading Gemini models', error);
        setModelsError('No se pudo actualizar la lista de modelos desde la API de Gemini.');
      } finally {
        setIsLoadingModels(false);
      }
    };

    loadModels();
  }, [localSettings.aiConfig?.apiKeySource, modelRefreshTick]);

  useEffect(() => {
    if (localSettings.aiConfig?.provider !== 'openrouter') return;
    const loadOpenRouterModels = async () => {
      setIsLoadingOpenRouterModels(true);
      setOpenRouterModelsError('');
      try {
        const key = localStorage.getItem('user_openrouter_key') || '';
        const models = await listModelsForProvider('openrouter', { apiKey: key });
        setAvailableOpenRouterModels(models);
      } catch (error) {
        console.error('Error loading OpenRouter models', error);
        setOpenRouterModelsError('No se pudo actualizar la lista de modelos de OpenRouter.');
        setAvailableOpenRouterModels([]);
      } finally {
        setIsLoadingOpenRouterModels(false);
      }
    };

    loadOpenRouterModels();
  }, [localSettings.aiConfig?.provider, openRouterKeyTick]);

  useEffect(() => {
    if (!localSettings.aiConfig?.model) {
      setLocalSettings(prev => ({
        ...prev,
        aiConfig: {
          ...prev.aiConfig,
          model: DEFAULT_TEXT_MODEL,
        },
      }));
    }
  }, [localSettings.aiConfig?.model]);

  const handleThemeChange = (theme: 'light' | 'dark') => {
    setLocalSettings(prev => ({...prev, theme}));
  }
  
  const handleLanguageChange = (language: 'en' | 'es') => {
    setLocalSettings(prev => ({...prev, language}));
  }

  const handleContextChange = (index: number, value: string) => {
    const newContext = [...localSettings.globalContext];
    newContext[index] = value;
    setLocalSettings(prev => ({ ...prev, globalContext: newContext }));
  };

  const addContextNote = () => {
    setLocalSettings(prev => ({ ...prev, globalContext: [...prev.globalContext, ''] }));
  };
  
  const removeContextNote = (index: number) => {
    const newContext = localSettings.globalContext.filter((_, i) => i !== index);
    setLocalSettings(prev => ({ ...prev, globalContext: newContext }));
  };

  const handleAIConfigChange = (field: keyof AIConfig, value: string | number | boolean) => {
    setLocalSettings(prev => {
        const model = resolveModelForProviderSwitch(field, value, prev.aiConfig?.provider);
        return {
            ...prev,
            aiConfig: {
                ...prev.aiConfig,
                [field]: value,
                ...(model !== undefined ? { model } : {}),
            }
        };
    });
  };

  const handleSaveUserKey = () => {
      localStorage.setItem('user_gemini_key', userApiKey);
      setModelRefreshTick(prev => prev + 1);
      console.log(t('keySaved'));
  };

  const handleSaveOpenRouterKey = () => {
      localStorage.setItem('user_openrouter_key', userOpenRouterApiKey);
      setOpenRouterKeyTick(prev => prev + 1);
      console.log(t('openRouterKeySaved'));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
        await updateSettings(localSettings);
        // Small delay to show the feedback clearly if the operation is too fast
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log(t('settingsSaved'));
    } catch (error) {
        console.error("Error saving settings:", error);
        console.error("Error al guardar la configuración.");
    } finally {
        setIsSaving(false);
    }
  };
  
  const handleClearRemoteData = async () => {
    if (!showClearConfirm) {
        setShowClearConfirm(true);
        return;
    }
    try {
        // Iterate over all projects and delete them one by one to ensure
        // related Firestore data (like chat history) is also cleaned up via logic in deleteProject
        for (const project of projects) {
            deleteProject(project.id);
        }
        console.log(t('dataCleared'));
        setShowClearConfirm(false);
        navigate('/'); // Navigate to home
    } catch (error) {
        console.error("Failed to clear remote data:", error);
        console.error("Error clearing data.");
        setShowClearConfirm(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-4 md:p-8 md:pl-20 overflow-y-auto bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" iconOnly aria-label="Volver al Dashboard" onClick={() => navigate('/')}>
            <ArrowLeftIcon className="w-5 h-5" />
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">{t('settings')}</h1>
        </div>
      </div>

      <div className="flex items-center space-x-2 border-b border-gray-200 dark:border-gray-700 mb-6">
        <TabButton label={t('aiConfig')} isActive={activeTab === 'ai'} onClick={() => setActiveTab('ai')} />
        <TabButton label={t('context')} isActive={activeTab === 'context'} onClick={() => setActiveTab('context')} />
        <TabButton label={t('appearance')} isActive={activeTab === 'appearance'} onClick={() => setActiveTab('appearance')} />
        <TabButton label="Cuenta" isActive={activeTab === 'account'} onClick={() => setActiveTab('account')} />
      </div>

      <div className="max-w-3xl w-full space-y-8">

        {/* AI Configuration Tab */}
        {activeTab === 'ai' && (
            <Card className="space-y-6">
                <div className="flex items-center">
                    <CpuChipIcon className="h-6 w-6 mr-3 text-primary-500"/>
                    <h2 className="text-xl font-semibold">{t('aiConfig')}</h2>
                </div>

                {/* API Key Source Selection */}
                <Card tone="muted" compact>
                    <h3 className="font-medium text-sm text-gray-900 dark:text-white mb-3">{t('apiKeySource')}</h3>

                    <div className="flex flex-col space-y-3 mb-4">
                        <label className="flex items-center space-x-3 cursor-pointer">
                            <input
                                type="radio"
                                name="apiKeySource"
                                value="global"
                                checked={localSettings.aiConfig?.apiKeySource === 'global' || !localSettings.aiConfig?.apiKeySource}
                                onChange={() => handleAIConfigChange('apiKeySource', 'global')}
                                className="form-radio h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300">{t('useGlobalKey')}</span>
                        </label>
                        <label className="flex items-center space-x-3 cursor-pointer">
                            <input
                                type="radio"
                                name="apiKeySource"
                                value="user"
                                checked={localSettings.aiConfig?.apiKeySource === 'user'}
                                onChange={() => handleAIConfigChange('apiKeySource', 'user')}
                                className="form-radio h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300">{t('useUserKey')}</span>
                        </label>
                    </div>


                {/* AI Provider Selection */}
                <Card tone="muted" compact>
                    <h3 className="font-medium text-sm text-gray-900 dark:text-white mb-3">{t('provider')}</h3>

                    <div className="flex flex-col space-y-3">
                        <label className="flex items-center space-x-3 cursor-pointer">
                            <input
                                type="radio"
                                name="provider"
                                value="gemini"
                                checked={localSettings.aiConfig?.provider !== 'openrouter'}
                                onChange={() => handleAIConfigChange('provider', 'gemini')}
                                className="form-radio h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300">{t('providerGemini')}</span>
                        </label>
                        <label className="flex items-center space-x-3 cursor-pointer">
                            <input
                                type="radio"
                                name="provider"
                                value="openrouter"
                                checked={localSettings.aiConfig?.provider === 'openrouter'}
                                onChange={() => handleAIConfigChange('provider', 'openrouter')}
                                className="form-radio h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300">{t('providerOpenRouter')}</span>
                        </label>
                    </div>
                </Card>

                <Card tone="muted" compact>
                    <label className="flex items-center justify-between gap-4 cursor-pointer">
                        <div>
                            <h3 className="font-medium text-sm text-gray-900 dark:text-white">{t('includeChatHistoryByDefault')}</h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Deshabilitado por defecto para reducir costo, ruido contextual y riesgo de contaminación entre conversaciones.</p>
                        </div>
                        <input
                            type="checkbox"
                            checked={Boolean(localSettings.aiConfig?.includeChatHistoryByDefault)}
                            onChange={(e) => handleAIConfigChange('includeChatHistoryByDefault', e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            aria-label={t('includeChatHistoryByDefault')}
                        />
                    </label>
                </Card>

                    {localSettings.aiConfig?.apiKeySource === 'user' && localSettings.aiConfig?.provider !== 'openrouter' && (
                        <div className="mt-4 animate-fade-in">
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                {t('apiKey')}
                            </label>
                            <div className="flex gap-2 items-center">
                                <Input
                                    type="password"
                                    value={userApiKey}
                                    onChange={(e) => setUserApiKey(e.target.value)}
                                    placeholder={t('userKeyPlaceholder')}
                                    className="flex-grow"
                                />
                                <Button variant="secondary" onClick={handleSaveUserKey}>{t('saveKey')}</Button>
                            </div>
                            <p className="text-xs text-gray-400 mt-2">
                                Esta llave se guarda únicamente en tu navegador.
                            </p>
                        </div>
                    )}
                </Card>

                {/* Model Selection (Gemini) */}
                {localSettings.aiConfig?.provider !== 'openrouter' && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('aiModel')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                        {t('aiModelHelp')} Valor por omisión: <span className="font-semibold">{DEFAULT_TEXT_MODEL}</span>.
                    </p>
                    {isLoadingModels && (
                        <p className="text-xs text-primary-600 dark:text-primary-400 mb-2">
                            Consultando modelos vigentes de Google Gemini...
                        </p>
                    )}
                    {modelsError && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">{modelsError}</p>
                    )}
                    <div className="grid grid-cols-1 gap-3">
                        {availableModels.map(model => {
                            const isSelected = localSettings.aiConfig?.model === model.id;
                            return (
                                <Card
                                    key={model.id}
                                    compact
                                    interactive
                                    onClick={() => handleAIConfigChange('model', model.id)}
                                    className={isSelected ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20' : ''}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-semibold text-gray-900 dark:text-white">{model.name}</span>
                                        {isSelected && <Badge tone="primary" size="xs" dot>Activo</Badge>}
                                    </div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{model.description}</p>
                                    <p className="text-[11px] text-gray-400 mt-1 font-mono">{model.id}</p>
                                </Card>
                            );
                        })}
                    </div>
                </div>
                )}

                {/* OpenRouter: API Key + Model Selection */}
                {localSettings.aiConfig?.provider === 'openrouter' && (
                    <>
                        <div className="mt-4 animate-fade-in">
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                {t('openRouterApiKey')}
                            </label>
                            <div className="flex gap-2 items-center">
                                <Input
                                    type="password"
                                    value={userOpenRouterApiKey}
                                    onChange={(e) => setUserOpenRouterApiKey(e.target.value)}
                                    placeholder={t('openRouterKeyPlaceholder')}
                                    className="flex-grow"
                                />
                                <Button variant="secondary" onClick={handleSaveOpenRouterKey}>{t('saveKey')}</Button>
                            </div>
                            <p className="text-xs text-gray-400 mt-2">
                                Esta llave se guarda únicamente en tu navegador. El modelo se ajusta a <span className="font-mono">openrouter/auto</span> por defecto.
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {t('openRouterModels')}
                            </label>
                            {isLoadingOpenRouterModels && (
                                <p className="text-xs text-primary-600 dark:text-primary-400 mb-2">
                                    Consultando modelos vigentes de OpenRouter...
                                </p>
                            )}
                            {openRouterModelsError && (
                                <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">{openRouterModelsError}</p>
                            )}
                            <div className="grid grid-cols-1 gap-3">
                                {availableOpenRouterModels.map(model => {
                                    const isSelected = localSettings.aiConfig?.model === model.id;
                                    return (
                                        <Card
                                            key={model.id}
                                            compact
                                            interactive
                                            onClick={() => handleAIConfigChange('model', model.id)}
                                            className={isSelected ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20' : ''}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="font-semibold text-gray-900 dark:text-white">{model.name}</span>
                                                {isSelected && <Badge tone="primary" size="xs" dot>Activo</Badge>}
                                            </div>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{model.description}</p>
                                            <p className="text-[11px] text-gray-400 mt-1 font-mono">{model.id}</p>
                                        </Card>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}

                {/* Temperature Slider */}
                <div>
                    <div className="flex justify-between items-center mb-1">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                            {t('temperature')}
                        </label>
                        <Badge tone="primary" size="sm">{localSettings.aiConfig?.temperature}</Badge>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t('temperatureHelp')}</p>
                    <div className="flex items-center space-x-4">
                        <span className="text-xs text-gray-400">{t('low')}</span>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={localSettings.aiConfig?.temperature || 0.7}
                            onChange={(e) => handleAIConfigChange('temperature', parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-primary-600"
                            aria-label={t('temperature')}
                        />
                        <span className="text-xs text-gray-400">{t('high')}</span>
                    </div>
                </div>

                {/* Tone / Style */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('tone')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('toneHelp')}</p>
                    <select
                        value={localSettings.aiConfig?.tone || 'Profesional y Técnico'}
                        onChange={(e) => handleAIConfigChange('tone', e.target.value)}
                        className="w-full h-10 px-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-colors"
                    >
                        <option value="Profesional y Técnico">Profesional y Técnico</option>
                        <option value="Ejecutivo y Conciso">Ejecutivo y Conciso</option>
                        <option value="Didáctico y Explicativo">Didáctico y Explicativo</option>
                        <option value="Creativo e Innovador">Creativo e Innovador</option>
                    </select>
                </div>
            </Card>
        )}

        {activeTab === 'context' && (
            <Card>
                <div className="flex items-center mb-4">
                    <DocumentTextIcon className="h-6 w-6 mr-3 text-primary-500"/>
                    <h2 className="text-xl font-semibold">{t('globalContext')}</h2>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('globalContextDescription')}</p>
                <div className="space-y-3">
                    {localSettings.globalContext.map((note, index) => (
                        <div key={index} className="flex items-center gap-2">
                            <Input
                                value={note}
                                onChange={(e) => handleContextChange(index, e.target.value)}
                                className="flex-grow"
                                aria-label={`Nota global ${index + 1}`}
                            />
                            <Button
                                variant="ghost"
                                iconOnly
                                size="sm"
                                aria-label={`Eliminar nota ${index + 1}`}
                                onClick={() => removeContextNote(index)}
                                className="text-gray-500 hover:text-red-500"
                            >
                                <TrashIcon className="h-5 w-5" />
                            </Button>
                        </div>
                    ))}
                </div>
                <Button
                    variant="outline"
                    leftIcon={<PlusCircleIcon className="h-4 w-4" />}
                    onClick={addContextNote}
                    className="mt-4"
                >
                    {t('addNote')}
                </Button>
            </Card>
        )}

        {activeTab === 'appearance' && (
            <Card>
                {/* Theme */}
                <div className="flex items-center mb-6">
                    <PaintBrushIcon className="h-6 w-6 mr-3 text-primary-500"/>
                    <h2 className="text-xl font-semibold">{t('theme')}</h2>
                </div>
                <div className="flex space-x-4">
                    {(['light', 'dark'] as const).map((mode) => {
                        const Icon = mode === 'light' ? SunIcon : MoonIcon;
                        const isActive = localSettings.theme === mode;
                        return (
                            <Card
                                key={mode}
                                compact
                                interactive
                                className={`flex-1 text-center ${isActive ? 'border-primary-500 ring-2 ring-primary-500/20' : ''}`}
                                onClick={() => handleThemeChange(mode)}
                            >
                                <Icon className="h-8 w-8 mx-auto mb-2"/>
                                <span className="font-medium">{t(mode)}</span>
                            </Card>
                        );
                    })}
                </div>

                <hr className="my-8 border-gray-200 dark:border-gray-700" />

                {/* Language */}
                <div className="flex items-center mb-4">
                    <LanguageIcon className="h-6 w-6 mr-3 text-primary-500"/>
                    <h2 className="text-xl font-semibold">{t('language')}</h2>
                </div>
                <div className="flex space-x-4">
                    {(['es', 'en'] as const).map((lang) => {
                        const flag = lang === 'es' ? '🇪🇸' : '🇬🇧';
                        const label = lang === 'es' ? t('spanish') : t('english');
                        const isActive = localSettings.language === lang;
                        return (
                            <Card
                                key={lang}
                                compact
                                interactive
                                className={`flex-1 text-center ${isActive ? 'border-primary-500 ring-2 ring-primary-500/20' : ''}`}
                                onClick={() => handleLanguageChange(lang)}
                            >
                                <span className="text-2xl">{flag}</span>
                                <span className="font-medium block mt-2">{label}</span>
                            </Card>
                        );
                    })}
                </div>
            </Card>
        )}

        {/* Account self-service. Its own forms save immediately against Firebase
            Auth, so it sits outside the settings document's Save button — a
            password change is not a preference to be batched with a theme. */}
        {activeTab === 'account' && <AccountPanel />}

        {activeTab !== 'account' && (
        <div className="flex justify-end mt-8">
            <Button onClick={handleSave} loading={isSaving} size="lg">
                {isSaving ? 'Guardando...' : t('save')}
            </Button>
        </div>
        )}

        <div className="mt-12 pt-8 border-t border-dashed border-red-500/30">
            <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50">
                <CardEyebrow className="text-red-600 dark:text-red-300">Zona Peligrosa</CardEyebrow>
                <h2 className="text-xl font-semibold text-red-700 dark:text-red-300 mt-1">{t('dangerZone')}</h2>
                <p className="text-sm text-red-600 dark:text-red-400 mt-2 mb-4">{t('clearDataDescription')}</p>
                <Button variant="danger" onClick={handleClearRemoteData}>
                    {showClearConfirm ? '¿Estás seguro? Haz clic de nuevo' : t('clearData')}
                </Button>
            </Card>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
