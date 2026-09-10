/**
 * DashboardPage — el centro de mando de la Oficina de Arquitectura.
 *
 * La pantalla con la que abre el sistema responde cinco preguntas, y las
 * responde **en este orden**, que es el orden en que se leen:
 *
 *   1. ¿En qué estado está todo?      → la cabecera: salud, cadena y desglose
 *   2. ¿Cómo va el trabajo?           → los KPI de flujo, con su tendencia
 *   3. ¿Qué me está esperando?        → la cola de decisiones
 *   4. ¿Dónde está el trabajo?        → el lienzo del portafolio
 *   5. ¿Qué está mal?                 → el centro de riesgo, y su detalle
 *
 * Deliberadamente **no** es un sitio donde trabajar. Crear una iniciativa,
 * abrir un entregable o editar un artefacto tienen cada uno su pantalla, y
 * duplicar aquí esos accesos convertiría la portada en una segunda versión de
 * otras tres. Lo que hace es enseñar dónde está el trabajo y entregar al lector
 * a la pantalla correcta, por id.
 *
 * ## Por qué esta pantalla ya no calcula nada
 *
 * Antes componía aquí mismo el grafo del portafolio, el retrato de la Oficina y
 * el resumen de iniciativas: tres módulos de servicio dentro de un fichero cuyo
 * trabajo es pintar. Eso la convertía en la capa de aplicación del tablero, que
 * es exactamente el patrón que este repositorio ya pagó caro en el lienzo de
 * artefactos. Toda esa composición vive ahora en `usePortfolioCommandCenter`, y
 * la pantalla recibe un modelo ya decidido.
 */

import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useAppContext } from '../context/AppContext';
import { useInitiatives } from '../context/InitiativeContext';
import { useOffice } from '../context/OfficeContext';
import { Button, Card, EmptyState, PageSkeleton, SectionHeader, StatTile } from '../components/ui';
import { ArrowRight, CheckCheck, Gauge, Layers, PackageCheck } from 'lucide-react';
import {
  BrokenLinksPanel,
  PortfolioCanvas,
  PortfolioSearchBox,
} from '../components/navigation';
import { AttentionCenter, PortfolioHealthHero } from '../components/dashboard';
import { DecisionQueue } from '../components/architectureOffice/dashboard';
import { usePortfolioCommandCenter } from '../hooks/usePortfolioCommandCenter';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { STAGGER, TRANSITION, TYPE } from '../lib/designTokens';
import { EA_LEVELS, PRODUCT_NAME } from '../lib/eaTerminology';
import type { PortfolioSearchHit } from '../services/portfolioGraph';

/**
 * La entrada escalonada de las regiones.
 *
 * El escalón es de 40 ms y eso es una decisión: existe para que las seis
 * regiones se lean como un grupo que llega, no para que el lector espere. Con
 * 150 ms el tablero tardaría casi un segundo en terminar de aparecer y se
 * miraría la animación en vez de los números.
 */
const region = (index: number, reduced: boolean) => ({
  initial: reduced ? false : { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { ...TRANSITION.enter, delay: reduced ? 0 : index * STAGGER },
});

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const { projects, isLoading: projectsLoading } = useAppContext();
  const { initiatives, isLoading: initiativesLoading } = useInitiatives();
  const { engagements, canApprove, loadEngagements } = useOffice();

  const {
    graph,
    portfolio,
    commandCenter,
    completionTrend,
    tasksDelta,
    deliveriesDelta,
    comparisonLabel,
  } = usePortfolioCommandCenter(initiatives, projects, engagements, loadEngagements);

  /** Navegar por id: un resultado nunca se vuelve a buscar por nombre. */
  const openHit = useCallback((hit: PortfolioSearchHit) => {
    if (hit.level === 'initiative') navigate(`/initiatives/${hit.id}`);
    else if (hit.level === 'attention') navigate(`/workspace/${hit.id}`);
    else if (hit.level === 'deliverable') navigate(`/office/${hit.id}`);
    else if (hit.path.attention) navigate(`/workspace/${hit.path.attention.id}?artifact=${hit.id}`);
  }, [navigate]);

  if (projectsLoading || initiativesLoading) {
    // El esqueleto de esta pantalla en concreto: cabecera, la cabecera héroe de
    // salud, cuatro KPI y los paneles. Es la primera pantalla que ve cualquiera
    // al abrir el producto, así que es la que más gana enseñando su forma en
    // vez de un disco girando.
    return (
      <div className="min-h-[100dvh] bg-mesh-light px-4 py-6 pb-24 dark:bg-mesh-dark md:pb-8 md:pl-20 md:pr-8">
        <div className="mx-auto max-w-7xl">
          <PageSkeleton label="Cargando el centro de mando" hero tiles={4} panels={2} />
        </div>
      </div>
    );
  }

  const nothingYet = initiatives.length === 0 && projects.length === 0;
  const { rollup } = portfolio;
  const planned = rollup.tasksTotal > 0;

  return (
    <div className="min-h-[100dvh] bg-mesh-light px-4 py-6 pb-24 dark:bg-mesh-dark md:pb-8 md:pl-20 md:pr-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className={TYPE.labelAccent}>{PRODUCT_NAME}</p>
            <h1 className={`mt-1 ${TYPE.pageTitle}`}>Centro de mando</h1>
            <p className={`mt-1 max-w-3xl ${TYPE.body}`}>
              {EA_LEVELS.initiative.short} → {EA_LEVELS.engagementProject.short} →{' '}
              {EA_LEVELS.deliverable.short} → {EA_LEVELS.artifact.singular}. En qué estado está
              todo, qué avanza y qué espera por una persona.
            </p>
          </div>
        </header>

        {nothingYet ? (
          <EmptyState
            title="El portafolio todavía está vacío"
            description="Empieza por la necesidad: registra una iniciativa de negocio y abre después el proyecto de arquitectura que lo sirva. El tablero mostrará la cadena completa."
            actions={(
              <Button variant="primary" onClick={() => navigate('/initiatives')}>
                Registrar la primera iniciativa
              </Button>
            )}
            flavor="ai"
          />
        ) : (
          <>
            <PortfolioSearchBox graph={graph} onSelect={openHit} />

            {/* 1 · En qué estado está todo. */}
            <PortfolioHealthHero
              model={commandCenter}
              counts={{
                initiatives: graph.initiatives.length,
                attentions: graph.attentions.length,
                deliverables: graph.deliverables.length,
                artifacts: graph.artifacts.length,
              }}
            />

            {/* 2 · Cómo va el trabajo. Los recuentos de cada nivel ya están en
                la cabecera, así que estos KPI miden **flujo**: qué se ha movido
                en la última ventana, no cuánto hay. Repetir arriba los mismos
                cuatro números sería una fila de tarjetas sin pregunta propia. */}
            <motion.div {...region(1, reducedMotion)} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile
                label="Tareas completadas"
                value={tasksDelta.current}
                icon={CheckCheck}
                tone="primary"
                trend={completionTrend}
                delta={tasksDelta.delta ?? undefined}
                since={tasksDelta.delta === null ? undefined : comparisonLabel}
                goodDirection="up"
                hint={tasksDelta.delta === null
                  ? 'Aún no hay ventana previa con la que comparar'
                  : undefined}
              />
              <StatTile
                label="Entregas cerradas"
                value={deliveriesDelta.current}
                icon={PackageCheck}
                tone="success"
                delta={deliveriesDelta.delta ?? undefined}
                since={deliveriesDelta.delta === null ? undefined : comparisonLabel}
                goodDirection="up"
                hint={deliveriesDelta.delta === null
                  ? 'Aún no hay ventana previa con la que comparar'
                  : undefined}
              />
              {/*
                Un 100 % sobre cero tareas es el mismo engaño que un 0 % sobre un
                portafolio sin medir: `completionRatio` vale 1 cuando no hay nada
                planificado. Sin plan, la tarjeta lo dice.
              */}
              <StatTile
                label="Avance planificado"
                value={planned ? `${Math.round(rollup.completionRatio * 100)}%` : 'Sin plan'}
                icon={Gauge}
                tone={planned && rollup.completionRatio < 0.4 ? 'warning' : 'primary'}
                meter={planned ? rollup.completionRatio : undefined}
                hint={planned
                  ? `${rollup.tasksCompleted} de ${rollup.tasksTotal} tareas`
                  : 'Se planifica al aprobar el charter de un entregable'}
              />
              <StatTile
                label="Artefactos producidos"
                value={rollup.artifactsProduced}
                icon={Layers}
                tone="ai"
                hint={`De ${graph.artifacts.length} artefacto(s) en el portafolio`}
              />
            </motion.div>

            {/* 3 · Qué espera por una persona. */}
            <motion.div {...region(2, reducedMotion)}>
              <DecisionQueue
                items={portfolio.decisionQueue}
                canApprove={canApprove}
                onOpen={(engagementId) => navigate(`/office/${engagementId}`)}
              />
            </motion.div>

            {/* 4 · Dónde está el trabajo. */}
            <motion.div {...region(3, reducedMotion)}>
              <Card className="space-y-3">
                <SectionHeader
                  as="h2"
                  title="Actividad del portafolio"
                  // El lienzo imprime abajo los tres niveles y la instrucción de
                  // uso. Repetirlas aquí hacía que la tarjeta dijera lo mismo
                  // dos veces con dos redacciones distintas.
                  description="Dónde está el trabajo ahora mismo, y de qué iniciativa cuelga cada cosa."
                  actions={(
                    <Button variant="ghost" size="xs" onClick={() => navigate('/office')}>
                      Ir a la Oficina
                      <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                  compact
                />
                <PortfolioCanvas
                  initiatives={initiatives}
                  attentions={portfolio.projects}
                  onOpenInitiative={(id) => navigate(`/initiatives/${id}`)}
                  onOpenAttention={(id) => navigate(`/workspace/${id}`)}
                  onOpenDeliverable={(id) => navigate(`/office/${id}`)}
                />
              </Card>
            </motion.div>

            {/* 5 · Qué está mal: primero el triaje, después el detalle. Es una
                relación resumen→detalle, no una repetición: el centro ordena
                nueve clases de señal por gravedad, y el panel de vínculos
                enumera uno por uno los registros de una de ellas, que es lo que
                hace falta para arreglarlos. */}
            <motion.div {...region(4, reducedMotion)} className="grid gap-4 lg:grid-cols-2">
              <AttentionCenter
                signals={commandCenter.signals}
                urgentSignals={commandCenter.urgentSignals}
              />
              <BrokenLinksPanel
                issues={graph.issues}
                onOpen={(issue) => {
                  if (issue.level === 'deliverable') navigate(`/office/${issue.sourceId}`);
                  else if (issue.level === 'attention') navigate(`/workspace/${issue.sourceId}`);
                  else navigate(`/initiatives/${issue.sourceId}`);
                }}
              />
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
};

export default DashboardPage;
