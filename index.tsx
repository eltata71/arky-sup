import React from 'react';
import ReactDOM from 'react-dom/client';
import { assertProductionRuntimeConfig } from './lib/runtimeConfig';
import { BrowserRouter } from 'react-router-dom';
import './src/index.css';
import App from './App';
import { AppContextProvider } from './context/AppContext';
import { AuthProvider } from './context/AuthContext';
import { LMSProvider } from './context/LMSContext';
import { OfficeProvider } from './context/OfficeContext';
import { InitiativeProvider } from './context/InitiativeContext';
import { ToastProvider } from './context/ToastContext';
import { CommandPaletteProvider } from './context/CommandPaletteContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ObservabilityProvider } from './context/ObservabilityContext';
import { AriaAnnouncerProvider } from './hooks/useAriaAnnouncer';
import { observabilityService } from './services/observability';

// Vite validates the same contract during build. Keeping a runtime assertion
// protects deployments produced by non-standard build wrappers as well.
assertProductionRuntimeConfig(import.meta.env);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const StartupRecoveryFallback: React.FC<{ error: unknown }> = ({ error }) => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="min-h-[100dvh] bg-gray-950 text-white flex items-center justify-center p-6" role="alert">
      <div className="max-w-lg w-full rounded-2xl border border-rose-900/60 bg-gray-900 p-6 shadow-pop">
        <p className="text-xs uppercase tracking-[0.18em] text-rose-300 font-semibold">Arranque protegido</p>
        <h1 className="mt-2 text-2xl font-bold">Arky 10 no pudo iniciar la sesión</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-300">La aplicación detectó el fallo y conservó una pantalla de recuperación en lugar de quedar en blanco.</p>
        <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 text-xs text-gray-200">{message}</pre>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => { window.location.href = '/'; }} className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200">Volver al inicio</button>
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white">Recargar</button>
        </div>
      </div>
    </div>
  );
};

observabilityService.registerBootSession();
observabilityService.installGlobalErrorHandlers();

const app = (
  <React.StrictMode>
    <ObservabilityProvider>
      <ErrorBoundary fallbackTitle="Error crítico al iniciar Arky 10">
        <AuthProvider>
          <AppContextProvider>
            {/* Initiatives sit above the Office: an initiative is the reason an
                engagement exists, so the Office may read them, never the
                reverse. */}
            <InitiativeProvider>
              <OfficeProvider>
                <LMSProvider>
                  <ToastProvider>
                    <AriaAnnouncerProvider>
                      <BrowserRouter>
                        <CommandPaletteProvider>
                          <App />
                        </CommandPaletteProvider>
                      </BrowserRouter>
                    </AriaAnnouncerProvider>
                  </ToastProvider>
                </LMSProvider>
              </OfficeProvider>
            </InitiativeProvider>
          </AppContextProvider>
        </AuthProvider>
      </ErrorBoundary>
    </ObservabilityProvider>
  </React.StrictMode>
);

const root = ReactDOM.createRoot(rootElement);
try {
  root.render(app);
  document.documentElement.dataset.arkyMounted = 'true';
  observabilityService.markAppMounted();
} catch (error) {
  observabilityService.reportError(error, {
    source: 'runtime',
    title: 'Fallo crítico durante el arranque de React',
    severity: 'critical',
    recoverable: true,
  });
  root.render(<StartupRecoveryFallback error={error} />);
}
