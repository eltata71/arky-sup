
import React, { useMemo, Suspense, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation, useParams, Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useAppContext } from './context/AppContext';
import { useAuth } from './context/AuthContext';
import { can, type Permission } from './lib/authz';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AlertTriangle } from 'lucide-react';
import { CommandPalette } from './components/CommandPalette';
import { useCommandPalette, type Command } from './context/CommandPaletteContext';
import { AppRail } from './components/AppRail';
import { MobileBottomNav } from './components/MobileBottomNav';
import { RuntimeErrorOverlay } from './components/RuntimeErrorOverlay';
import { GlobalObservabilityCenter } from './components/GlobalObservabilityCenter';
import { PersistenceStatusBanner } from './components/PersistenceStatusBanner';
import { lazyWithRetry } from './components/routing/lazyWithRetry';
import {
    HomeIcon,
    FolderOpenIcon,
    Cog6ToothIcon,
    AcademicCapIcon,
    SparklesIcon,
    ChatBubbleLeftRightIcon,
    BuildingOffice2Icon,
} from './components/Icons';

// Route chunks are loaded through `lazyWithRetry` so a transient Safari/iPad
// chunk-fetch failure (or a stale bundle after a deploy) self-recovers instead
// of stranding the user on a black "Cargando…" screen.
const DashboardPage = lazyWithRetry(() => import('./pages/DashboardPage'), { chunkName: 'DashboardPage' });
const ProjectsPage = lazyWithRetry(() => import('./pages/ProjectsPage'), { chunkName: 'ProjectsPage' });
const SettingsPage = lazyWithRetry(() => import('./pages/SettingsPage'), { chunkName: 'SettingsPage' });
const Workspace = lazyWithRetry(() => import('./pages/Workspace'), { chunkName: 'Workspace' });
const TrainingCenterPage = lazyWithRetry(() => import('./pages/TrainingCenterPage').then(m => ({ default: m.TrainingCenterPage })), { chunkName: 'TrainingCenterPage' });
const AuthPage = lazyWithRetry(() => import('./pages/AuthPage').then(m => ({ default: m.AuthPage })), { chunkName: 'AuthPage' });
const UserManagementPage = lazyWithRetry(() => import('./pages/UserManagementPage').then(m => ({ default: m.UserManagementPage })), { chunkName: 'UserManagementPage' });
const SDDProcessView = lazyWithRetry(() => import('./pages/SDDProcessView'), { chunkName: 'SDDProcessView' });
const OfficePage = lazyWithRetry(() => import('./pages/OfficePage'), { chunkName: 'OfficePage' });
const EngagementRoom = lazyWithRetry(() => import('./pages/EngagementRoom'), { chunkName: 'EngagementRoom' });
const InitiativesPage = lazyWithRetry(() => import('./pages/InitiativesPage'), { chunkName: 'InitiativesPage' });
const InitiativeRoom = lazyWithRetry(() => import('./pages/InitiativeRoom'), { chunkName: 'InitiativeRoom' });
const AgentsPage = lazyWithRetry(() => import('./pages/AgentsPage'), { chunkName: 'AgentsPage' });

/*
 * La guía de uso se carga bajo demanda, como una ruta. Vive en el raíl, que
 * está en el árbol desde el arranque, y detrás tiene la capa de IA: importarla
 * de forma estática metería ese chunk en el arranque de la aplicación para
 * todos, incluido quien nunca abra la ayuda.
 */
const PlatformGuideDock = lazyWithRetry(
  () => import('./components/platformGuide').then((m) => ({ default: m.PlatformGuideDock })),
  { chunkName: 'PlatformGuideDock' },
);

/*
 * La hoja de atajos se carga igual, y por la misma razón. Es un modal que se
 * abre con `?` y que la mayoría de las sesiones no abre nunca; estaba en el
 * chunk de arranque porque el árbol de la aplicación la montaba siempre, aunque
 * sólo pintara algo con `open`. Un componente que no dibuja nada hasta que
 * alguien lo pide no tiene por qué descargarse antes del primer píxel.
 */
const KeyboardShortcutsModal = lazyWithRetry(
  () => import('./components/KeyboardShortcutsModal').then((m) => ({ default: m.KeyboardShortcutsModal })),
  { chunkName: 'KeyboardShortcutsModal' },
);

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-full" role="status" aria-label="Cargando">
    <div className="flex flex-col items-center gap-3 animate-fade-in">
      <div className="relative h-12 w-12">
        <div className="absolute inset-0 rounded-full bg-primary-200/50 dark:bg-primary-900/40 animate-ping" />
        <div className="relative h-12 w-12 border-[3px] border-primary-200 dark:border-primary-900 border-t-primary-600 dark:border-t-primary-300 rounded-full animate-spin" />
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Cargando…</p>
    </div>
  </div>
);

const WorkspaceWrapper = () => {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  return <Workspace projectId={projectId} />;
};

const SDDProcessWrapper = () => {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  return <SDDProcessView projectId={projectId} />;
};

/**
 * A route that requires a session, and optionally a permission.
 *
 * The permission is checked here as well as inside the screen. That is not
 * redundancy for its own sake: the rail hides the entry point, but a URL typed
 * by hand reaches the route directly, and a screen that renders its shell
 * before deciding has already told the visitor what lives there.
 *
 * `isLoading` covers the profile fetch, so this never redirects a session whose
 * role has not resolved yet — which would sign out every administrator on a
 * slow connection.
 */
const ProtectedRoute = ({
  children,
  permission,
}: {
  children: React.ReactNode;
  permission?: Permission;
}) => {
  const { user, profile, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingFallback />;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (permission && !can(profile, permission)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const GlobalCommands: React.FC = () => {
    // Registers navigation + global AI shortcuts + recent projects in the command palette.
    // Lives inside the Router so it can dispatch React Router navigations.
    const navigate = useNavigate();
    const { user, profile } = useAuth();
    const { register } = useCommandPalette();
    const { projects } = useAppContext();

    // Recent projects: top 8 by updatedAt — populated in the palette under
    // "Proyectos recientes" so jumping back to a project is one keystroke.
    const recentProjects = useMemo(() => {
        if (!projects || projects.length === 0) return [];
        return [...projects]
            .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
            .slice(0, 8);
    }, [projects]);

    useEffect(() => {
        if (!user) return;
        const commands: Command[] = [
            { id: 'nav.home', section: 'Navegación', title: 'Ir al Dashboard', subtitle: 'Vista principal con proyectos y formación', icon: <HomeIcon className="h-4 w-4" />, run: () => navigate('/'), keywords: ['inicio','home','dashboard'] },
            { id: 'nav.projects', section: 'Navegación', title: 'Ver todos los proyectos', subtitle: 'Listado completo de proyectos de arquitectura', icon: <FolderOpenIcon className="h-4 w-4" />, run: () => navigate('/projects'), keywords: ['projects','listado','arquitectura'] },
            { id: 'nav.office', section: 'Navegación', title: 'Oficina de Arquitectura', subtitle: 'Encargos, especialistas y comité de arquitectura', icon: <BuildingOffice2Icon className="h-4 w-4" />, run: () => navigate('/office'), keywords: ['oficina','encargo','office','agentes','comité','arb'] },
            { id: 'nav.agents', section: 'Navegación', title: 'Agentes de la Oficina', subtitle: 'La ficha de cada arquitecto: habilidades, conocimiento, memoria y modelo', icon: <BuildingOffice2Icon className="h-4 w-4" />, run: () => navigate('/agents'), keywords: ['agentes','ficha','arquitectos','especialistas','reparto'] },
            { id: 'nav.training', section: 'Navegación', title: 'Centro de Formación', subtitle: 'Cursos, rutas de aprendizaje y notas inteligentes', icon: <AcademicCapIcon className="h-4 w-4" />, run: () => navigate('/training'), keywords: ['curso','formación','training','lms'] },
            { id: 'nav.settings', section: 'Navegación', title: 'Configuración', subtitle: 'Tema, idioma, modelo de IA, claves', icon: <Cog6ToothIcon className="h-4 w-4" />, run: () => navigate('/settings'), keywords: ['config','tema','dark','idioma','clave'] },
            ...(profile?.role === 'admin' || profile?.role === 'superadmin' ? [
                { id: 'nav.users', section: 'Navegación', title: 'Gestión de Usuarios', icon: <Cog6ToothIcon className="h-4 w-4" />, run: () => navigate('/users') } as Command,
            ] : []),
            { id: 'ai.new-project', section: 'IA · Arquitecto', title: 'Crear nuevo proyecto con IA', subtitle: 'Asistente guiado por el Arquitecto Agente', flavor: 'ai', icon: <SparklesIcon className="h-4 w-4" />, run: () => navigate('/?action=new-project'), keywords: ['nuevo','proyecto','generar','asistente'] },
            { id: 'ai.consult', section: 'IA · Arquitecto', title: 'Consultar al Arquitecto Agente', subtitle: 'Pregunta cualquier duda de arquitectura o spec-driven development', flavor: 'ai', icon: <ChatBubbleLeftRightIcon className="h-4 w-4" />, run: () => navigate('/?action=consult'), keywords: ['consultar','chat','dudas','arquitectura','agente'] },
            ...recentProjects.map<Command>((p) => ({
                id: `recent.${p.id}`,
                section: 'Proyectos recientes',
                title: p.name,
                subtitle: `${p.artifacts.length} artefactos · actualizado ${new Date(p.updatedAt || p.createdAt).toLocaleDateString()}`,
                icon: <FolderOpenIcon className="h-4 w-4" />,
                keywords: [p.description ?? ''],
                run: () => navigate(`/workspace/${p.id}`),
            })),
        ];
        return register(commands);
    }, [user, profile?.role, navigate, register, recentProjects]);

    return null;
};

const App: React.FC = () => {
  const { projects, settings } = useAppContext();
  const { error: authError } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [guideOpen, setGuideOpen] = React.useState(false);
  const observabilityProjectId = location.pathname.match(/^\/(?:workspace|sdd-process)\/([^/]+)/)?.[1];
  const observabilityProject = observabilityProjectId
    ? projects.find((project) => project.id === observabilityProjectId)
    : undefined;


  const navigateToWorkspace = (id: string) => {
    navigate(`/workspace/${id}`);
  };

  // Global "?" → keyboard shortcuts modal.  Skipped when typing in an input.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (event.key === '?' && !isTyping) {
        event.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);


  return (
    <div className="flex h-[100dvh] bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 overflow-hidden font-sans selection:bg-primary-100 dark:selection:bg-primary-900">
      {authError && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-red-500 text-white p-4 flex items-center justify-center shadow-md">
          <AlertTriangle className="w-5 h-5 mr-2" />
          <p className="text-sm font-medium">{authError}</p>
        </div>
      )}

      {/* Persistent navigation rail (hidden on /auth and on small screens). */}
      <AppRail onOpenShortcuts={() => setShortcutsOpen(true)} onOpenGuide={() => setGuideOpen(true)} />
      {/* Mobile bottom navigation — visible below md, hidden when AppRail shows. */}
      <MobileBottomNav onOpenGuide={() => setGuideOpen(true)} />

      {/* Skip to main content — first focusable element for keyboard users */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:bg-primary-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:font-medium focus:shadow-lg">
        Saltar al contenido principal
      </a>

      {/* Main Content — pages already reserve `pl-16 md:pl-20` so the fixed
          AppRail (`w-14`) sits inside that gutter without overlapping.  On
          mobile we add `pb-16` so the fixed bottom nav (`h-16`) doesn't
          eclipse the last row of content. */}
      <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col overflow-hidden relative w-full bg-white dark:bg-gray-950 pb-16 md:pb-0">
        <PersistenceStatusBanner />
        <ErrorBoundary key={location.pathname} fallbackTitle="Error en la aplicación">
          <Suspense fallback={<LoadingFallback />}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname.split('/').slice(0, 3).join('/')}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col flex-1 min-h-0"
              >
                <Routes location={location}>
                  <Route path="/auth" element={<AuthPage />} />
                  <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
                  <Route path="/projects" element={<ProtectedRoute><ProjectsPage navigateToWorkspace={navigateToWorkspace} /></ProtectedRoute>} />
                  <Route path="/office" element={<ProtectedRoute><OfficePage /></ProtectedRoute>} />
                  <Route path="/initiatives" element={<ProtectedRoute><InitiativesPage /></ProtectedRoute>} />
                  <Route path="/initiatives/:initiativeId" element={<ProtectedRoute><InitiativeRoom /></ProtectedRoute>} />
                  <Route path="/office/:engagementId" element={<ProtectedRoute><EngagementRoom /></ProtectedRoute>} />
                  <Route path="/agents" element={<ProtectedRoute><AgentsPage /></ProtectedRoute>} />
                  <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
                  <Route path="/training" element={<ProtectedRoute><TrainingCenterPage /></ProtectedRoute>} />
                  <Route path="/users" element={<ProtectedRoute permission="users:read"><UserManagementPage /></ProtectedRoute>} />
                  <Route path="/workspace/:projectId" element={<ProtectedRoute><WorkspaceWrapper /></ProtectedRoute>} />
                  <Route path="/sdd-process/:projectId" element={<ProtectedRoute><SDDProcessWrapper /></ProtectedRoute>} />
                  <Route path="*" element={<ProtectedRoute><NotFoundPage /></ProtectedRoute>} />
                </Routes>
              </motion.div>
            </AnimatePresence>
          </Suspense>
        </ErrorBoundary>
      </main>

      {/* Global Cmd+K command palette + navigation commands */}
      <GlobalCommands />
      <CommandPalette />
      {shortcutsOpen && (
        <Suspense fallback={null}>
          <KeyboardShortcutsModal open onClose={() => setShortcutsOpen(false)} />
        </Suspense>
      )}
      {/* Sólo se monta —y sólo se descarga su chunk— cuando alguien la abre. */}
      {guideOpen && (
        <Suspense fallback={null}>
          <PlatformGuideDock open onClose={() => setGuideOpen(false)} settings={settings} />
        </Suspense>
      )}
      <RuntimeErrorOverlay />
      <GlobalObservabilityCenter project={observabilityProject} />
    </div>
  );
};

const NotFoundPage: React.FC = () => {
    const navigate = useNavigate();
    return (
        <div className="flex items-center justify-center w-full h-full p-6">
            <div className="text-center max-w-md animate-slide-up">
                <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-ai-gradient text-white shadow-glow-ai mb-5">
                    <SparklesIcon className="h-7 w-7" />
                </div>
                <p className="text-2xs uppercase tracking-widest-2 font-semibold text-gray-500 dark:text-gray-400 mb-2">404</p>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight mb-2">
                    Esta ruta no existe en tu mapa de arquitectura
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                    Es posible que el enlace haya cambiado o que aún no hayas creado este artefacto.
                </p>
                <div className="flex items-center justify-center gap-2">
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        className="inline-flex items-center justify-center h-10 px-4 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                        Ir al Dashboard
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate(-1)}
                        className="inline-flex items-center justify-center h-10 px-4 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                        Volver atrás
                    </button>
                </div>
            </div>
        </div>
    );
};

export default App;
