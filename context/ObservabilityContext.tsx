import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  observabilityService,
  type ObservabilityErrorInput,
  type ObservabilityEvent,
} from '../services/observability';

interface ObservabilitySummary {
  total: number;
  activeIssues: number;
  critical: number;
  warnings: number;
  successes: number;
  lastEvent?: ObservabilityEvent;
  systemStatus: 'healthy' | 'attention' | 'critical';
}

interface ObservabilityContextType {
  events: ObservabilityEvent[];
  summary: ObservabilitySummary;
  reportError: (error: unknown, input?: ObservabilityErrorInput) => ObservabilityEvent;
  trackEvent: typeof observabilityService.trackEvent;
  clear: () => void;
}

const ObservabilityContext = createContext<ObservabilityContextType | undefined>(undefined);

const buildSummary = (events: ObservabilityEvent[]): ObservabilitySummary => {
  const activeIssues = events.filter((event) => event.severity === 'error' || event.severity === 'critical').length;
  const critical = events.filter((event) => event.severity === 'critical').length;
  const warnings = events.filter((event) => event.severity === 'warning').length;
  const successes = events.filter((event) => event.severity === 'success').length;
  return {
    total: events.length,
    activeIssues,
    critical,
    warnings,
    successes,
    lastEvent: events[0],
    systemStatus: critical > 0 ? 'critical' : activeIssues > 0 || warnings > 0 ? 'attention' : 'healthy',
  };
};

export const ObservabilityProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [events, setEvents] = useState<ObservabilityEvent[]>(() => observabilityService.getSnapshot());

  useEffect(() => {
    observabilityService.installGlobalErrorHandlers();
    const unsubscribe = observabilityService.subscribe(setEvents);
    observabilityService.trackEvent({
      severity: 'success',
      source: 'app',
      status: 'observed',
      title: 'Monitoreo global activo',
      message: 'La aplicación está capturando errores de render, ejecución, red y carga de recursos.',
      recoverable: true,
      userVisible: true,
    });
    return unsubscribe;
  }, []);

  const reportError = useCallback((error: unknown, input?: ObservabilityErrorInput) => (
    observabilityService.reportError(error, input)
  ), []);

  const clear = useCallback(() => observabilityService.clear(), []);

  const value = useMemo<ObservabilityContextType>(() => ({
    events,
    summary: buildSummary(events),
    reportError,
    trackEvent: observabilityService.trackEvent.bind(observabilityService),
    clear,
  }), [clear, events, reportError]);

  return (
    <ObservabilityContext.Provider value={value}>
      {children}
    </ObservabilityContext.Provider>
  );
};

export const useObservability = (): ObservabilityContextType => {
  const context = useContext(ObservabilityContext);
  if (!context) {
    throw new Error('useObservability must be used within an ObservabilityProvider');
  }
  return context;
};
