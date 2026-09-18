/**
 * AppRail — la navegación del producto, en el borde izquierdo de toda ruta
 * autenticada. Las páginas ya reservan `pl-16 md:pl-20`, así que el raíl vive
 * en ese canal sin solaparse con el contenido.
 *
 * Oculto en `/auth` (todavía no hay contexto de sesión).
 *
 * ## Compacto por defecto, ancho cuando hace falta
 *
 * El raíl estrecho es correcto para quien ya sabe dónde está cada cosa: un
 * glifo y tres sílabas bastan cuando has hecho el recorrido cien veces. Es
 * exactamente inútil el primer día, cuando «Entregables» y «Proyectos» son dos
 * palabras que aún no se distinguen.
 *
 * Así que hay dos estados y ninguno reemplaza al otro. En reposo mide 72 px. Al
 * pasar el cursor —o al entrar el foco de teclado, que es la mitad que se suele
 * olvidar— se despliega a 264 px y aparece lo que no cabía: el nombre largo, la
 * frase que dice para qué sirve el destino, y los rótulos que separan el
 * trabajo del sistema. Se puede **fijar** abierto, y esa preferencia se
 * recuerda: quien está aprendiendo el producto no debería tener que sostener el
 * ratón encima para poder leerlo.
 *
 * Tres decisiones que hacen que el despliegue no moleste:
 *
 * - **Se abre con retardo y se cierra sin él.** Cruzar el raíl camino de otra
 *   cosa no debe abrirlo; salir de él sí debe cerrarlo, inmediatamente.
 * - **El foco lo abre siempre y sin retardo.** Tabular a ciegas por un raíl que
 *   tarda en decir dónde estás es peor que uno que no se despliega.
 * - **Se superpone, no empuja.** El `aside` es `fixed`: al ensancharse no mueve
 *   ni un píxel del contenido, así que abrirlo nunca hace saltar la línea que
 *   estabas leyendo.
 *
 * El indicador de página activa es un solo elemento compartido (`layoutId`):
 * viaja de un destino a otro en lugar de aparecer y desaparecer, que es lo que
 * hace que el raíl se lea como un sitio y no como ocho botones.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { can } from '../lib/authz';
import { useCommandPalette } from '../context/CommandPaletteContext';
import { Tooltip } from './ui/Tooltip';
import { AIArchitectAvatar } from './ui/AIArchitectIdentity';
import { cn } from './ui/cn';
import { useTheme } from '../hooks/useTheme';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useRailExpansion } from '../hooks/useRailExpansion';
import { useKeyboardModality } from '../hooks/useKeyboardModality';
import { SPRING } from '../lib/designTokens';
import { RAIL_GROUP_LABELS, RAIL_ITEMS } from './navigation/appRailItems';
import { AppRailFooter } from './navigation/AppRailFooter';
import { RailRevealedText } from './navigation/RailRevealedText';
import { PRODUCT_NAME } from '../lib/eaTerminology';

const RAIL_COLLAPSED = 72;
const RAIL_EXPANDED = 264;


export interface AppRailProps {
    /** Abre el modal de atajos de teclado, cuyo estado vive en `App`. */
    onOpenShortcuts?: () => void;
    /**
     * Abre la guía de uso de la plataforma.
     *
     * Está en el raíl y no dentro de una pantalla porque la pregunta que
     * atiende —«¿cómo funciona esto?»— no depende de dónde estés parado, que
     * es justamente lo contrario del asistente de la Oficina: ése responde
     * sobre un registro concreto y se abre desde ese registro.
     */
    onOpenGuide?: () => void;
}

export const AppRail: React.FC<AppRailProps> = ({ onOpenShortcuts, onOpenGuide }) => {
    const { user, profile, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const { setOpen: setPaletteOpen } = useCommandPalette();
    const { resolved: theme, toggle: toggleTheme } = useTheme();
    const reducedMotion = useReducedMotion();
    const { pinned, setPinned } = useRailExpansion();
    const modality = useKeyboardModality();

    const [hovered, setHovered] = useState(false);
    const [focusWithin, setFocusWithin] = useState(false);
    const hoverTimer = useRef<number | null>(null);

    /** Abrir con retardo, cerrar sin él. Ver la nota de cabecera. */
    const openOnHover = useCallback(() => {
        if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => setHovered(true), 180);
    }, []);
    const closeOnHover = useCallback(() => {
        if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
        setHovered(false);
    }, []);
    useEffect(() => () => {
        if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    }, []);

    // Ocultar en las pantallas de sesión (todavía no hay usuario).
    if (!user) return null;
    if (location.pathname.startsWith('/auth')) return null;

    const expanded = pinned || hovered || focusWithin;
    const items = RAIL_ITEMS.filter((item) => !item.permission || can(profile, item.permission));

    /** Envuelve en tooltip sólo cuando está plegado: abierto ya se lee el texto. */
    const withTooltip = (label: string, node: React.ReactElement) =>
        expanded ? node : <Tooltip label={label} side="right">{node}</Tooltip>;

    return (
        <motion.aside
            aria-label="Navegación principal"
            onMouseEnter={openOnHover}
            onMouseLeave={closeOnHover}
            /*
             * Sólo el foco **de teclado** mantiene abierto el raíl.
             *
             * Un clic con el ratón también da foco al botón, así que con un
             * `onFocus` a secas cualquier clic —cambiar el tema, abrir la
             * búsqueda— dejaba el raíl desplegado tapando el contenido hasta
             * que el usuario pulsaba en otro sitio. La modalidad es la misma
             * distinción que hace el navegador para `:focus-visible`; ver
             * `useKeyboardModality` para por qué no se usa el selector.
             */
            onFocusCapture={() => {
                if (modality.current === 'keyboard') setFocusWithin(true);
            }}
            onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
            }}
            initial={false}
            animate={{ width: expanded ? RAIL_EXPANDED : RAIL_COLLAPSED }}
            transition={reducedMotion ? { duration: 0 } : SPRING}
            className={cn(
                'fixed bottom-0 left-0 top-0 z-40 hidden flex-col justify-between overflow-hidden py-3 md:flex',
                'border-r border-gray-200 bg-white/85 backdrop-blur-md dark:border-gray-800 dark:bg-gray-950/85',
                // Sólo al desplegarse se separa de la página: plegado es parte
                // del marco, abierto es una superficie que está por encima.
                expanded && 'shadow-[0_4px_8px_rgba(15,23,42,0.06),0_16px_40px_-12px_rgba(15,23,42,0.22)]',
            )}
        >
            {/* Arriba: marca + navegación */}
            {/*
                El acolchado es distinto en cada estado y tiene que serlo. El
                raíl mide 72 px: con `px-3` al botón le quedan 48 y los nombres
                cortos truncan a «Iniciati…», que es peor que no ponerlos. Con
                `px-1` recupera los 64 px para los que se eligieron esos
                nombres. Desplegado hay sitio de sobra y el margen mayor es el
                que separa el texto del borde.
            */}
            <div className={cn('flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto', expanded ? 'px-3' : 'px-1')}>
                {withTooltip(PRODUCT_NAME, (
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        className="flex h-11 shrink-0 items-center gap-2.5 rounded-2xl px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        aria-label="Ir al centro de mando"
                    >
                        <AIArchitectAvatar size="sm" />
                        <RailRevealedText show={expanded} reduced={reducedMotion} className="min-w-0 truncate text-sm font-bold tracking-tight text-gray-900 dark:text-gray-50">
                            ArkyPro
                        </RailRevealedText>
                    </button>
                ))}

                <div className="my-1 h-px w-full bg-gray-200 dark:bg-gray-800" aria-hidden />

                <nav className="flex flex-col gap-0.5">
                    {items.map((item, index) => {
                        const active = item.match(location.pathname);
                        const startsGroup = index > 0 && items[index - 1].group !== item.group;
                        const groupLabel = RAIL_GROUP_LABELS[item.group];
                        return (
                            <React.Fragment key={item.id}>
                                {startsGroup && (
                                    <div className="mt-2 flex h-5 items-center px-1" aria-hidden>
                                        {expanded && groupLabel
                                            ? (
                                                <RailRevealedText show reduced={reducedMotion} className="text-2xs font-bold uppercase tracking-widest-2 text-gray-400 dark:text-gray-500">
                                                    {groupLabel}
                                                </RailRevealedText>
                                            )
                                            : <span className="h-px w-6 bg-gray-200 dark:bg-gray-800" />}
                                    </div>
                                )}
                                {withTooltip(item.hint ? `${item.longLabel} · ${item.hint}` : item.longLabel, (
                                    <button
                                        type="button"
                                        onClick={() => navigate(item.href)}
                                        aria-current={active ? 'page' : undefined}
                                        // El nombre accesible es el largo en los dos
                                        // estados. Todo el texto visible es
                                        // `aria-hidden`, así que abrir el raíl cambia
                                        // lo que se ve y nunca lo que se anuncia.
                                        aria-label={item.longLabel}
                                        className={cn(
                                            'relative flex w-full rounded-xl transition-colors',
                                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                                            // Plegado: glifo arriba y nombre corto
                                            // debajo, que es lo que se puede
                                            // rastrear de un vistazo. Abierto: una
                                            // fila con el nombre largo y su frase.
                                            expanded
                                                ? 'items-center gap-3 px-2 py-2'
                                                : 'flex-col items-center gap-0.5 px-1 py-1.5',
                                            active
                                                ? 'text-primary-700 dark:text-primary-200'
                                                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white',
                                            item.primary && !active && 'text-primary-600 dark:text-primary-300',
                                        )}
                                    >
                                        {/* El fondo del elemento activo es un único
                                            elemento compartido que viaja entre
                                            destinos. Va detrás del contenido y no lo
                                            tapa. */}
                                        {active && (
                                            <motion.span
                                                layoutId={reducedMotion ? undefined : 'rail-active'}
                                                transition={SPRING}
                                                className="absolute inset-0 -z-10 rounded-xl bg-primary-100 dark:bg-primary-900/40"
                                                aria-hidden
                                            />
                                        )}
                                        <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                                            {item.icon}
                                        </span>
                                        {expanded ? (
                                            <RailRevealedText show reduced={reducedMotion} className="flex min-w-0 flex-1 flex-col text-left">
                                                <span className="truncate text-sm font-semibold leading-tight">{item.longLabel}</span>
                                                {item.hint && (
                                                    <span className="truncate text-2xs leading-tight text-gray-500 dark:text-gray-500">
                                                        {item.hint}
                                                    </span>
                                                )}
                                            </RailRevealedText>
                                        ) : (
                                            <span aria-hidden className="w-full truncate text-center text-[9px] font-semibold leading-tight tracking-tight">
                                                {item.label}
                                            </span>
                                        )}
                                        {active && <span className={cn('absolute top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary-500', expanded ? '-left-2' : '-left-1')} aria-hidden />}
                                    </button>
                                ))}
                            </React.Fragment>
                        );
                    })}
                </nav>
            </div>

            <AppRailFooter
                expanded={expanded}
                reducedMotion={reducedMotion}
                withTooltip={withTooltip}
                theme={theme}
                onToggleTheme={toggleTheme}
                onOpenSearch={() => setPaletteOpen(true)}
                onOpenShortcuts={onOpenShortcuts}
                onOpenGuide={onOpenGuide}
                pinned={pinned}
                onTogglePinned={() => setPinned(!pinned)}
                onSignOut={logout}
            />
        </motion.aside>
    );
};

export default AppRail;
