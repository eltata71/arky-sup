/**
 * Mobile bottom navigation — visible on screens narrower than md (768px).
 *
 * This is the AppRail in a thumb-reachable form factor, not a second menu: it
 * carries exactly the rail's destinations and nothing else.  The four working
 * screens plus global search sit in the bar; the system screens (Agentes,
 * Formación, Configuración, Seguridad) live in the "Más" sheet, because a bar
 * of eight columns is unreadable on a phone and dropping them would leave a
 * mobile user with no way to reach settings at all.
 *
 * **Y «exactamente las mismas» ahora lo es de verdad.** Hasta ahora esta
 * pantalla declaraba su propia copia de la lista —los mismos iconos, las mismas
 * rutas, los mismos emparejadores de ruta— y una copia sólo permanece igual
 * mientras alguien se acuerda de las dos. Ambas superficies leen ya
 * `RAIL_ITEMS`, que es el único sitio donde vive la arquitectura de información
 * del producto; el reparto entre la barra y la hoja «Más» sale del `group` que
 * cada destino ya declaraba, no de una segunda lista escrita a mano.
 *
 * The bar respects safe-area insets so it doesn't sit under the iOS home
 * indicator.
 */

import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { can } from '../lib/authz';
import { useCommandPalette } from '../context/CommandPaletteContext';
import { cn } from './ui/cn';
import { AIArchitectAvatar } from './ui/AIArchitectIdentity';
import { MoonIcon, SparklesIcon, SunIcon } from './Icons';
import { EllipsisVertical, LifeBuoy } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { RAIL_ITEMS } from './navigation/appRailItems';
import { PRODUCT_SHORT_NAME } from '../lib/eaTerminology';

interface NavItem {
    id: string;
    /** Visible label. Short register in the bar, long one in the sheet. */
    label: string;
    /**
     * Accessible name. Defaults to `label`; the bar sets it to the long name so
     * a screen reader hears what the screen is actually called, exactly as the
     * desktop rail does.
     */
    name?: string;
    icon: React.ReactNode;
    href?: string;
    match?: (path: string) => boolean;
    onClick?: () => void;
    flavor?: 'default' | 'ai';
}

/** Los destinos de trabajo: los que van en la barra, en el orden del raíl. */
const WORKING_ITEMS = RAIL_ITEMS.filter((item) => item.group !== 'system');
/** Los de sistema: los que van dentro de «Más». */
const SYSTEM_ITEMS = RAIL_ITEMS.filter((item) => item.group === 'system');

/** Tailwind only sees literal class strings, so the columns are written out. */
const GRID_COLUMNS: Record<number, string> = {
    4: 'grid-cols-4',
    5: 'grid-cols-5',
    6: 'grid-cols-6',
    7: 'grid-cols-7',
};

export interface MobileBottomNavProps {
    /** Abre la guía de uso. La misma que el raíl: una ayuda, no dos. */
    onOpenGuide?: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ onOpenGuide }) => {
    const { user, profile } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const { setOpen: setPaletteOpen } = useCommandPalette();
    const [moreOpen, setMoreOpen] = useState(false);
    const { resolved: theme, toggle: toggleTheme } = useTheme();

    if (!user) return null;
    if (location.pathname.startsWith('/auth')) return null;

    // Mismo orden que el raíl de escritorio y por la misma razón: el tablero es
    // donde abre el sistema, y después el trabajo, de fuera hacia dentro.
    const items: NavItem[] = [
        ...WORKING_ITEMS.map((item) => ({
            id: item.id,
            label: item.label,
            name: item.longLabel,
            icon: item.icon,
            href: item.href,
            match: item.match,
        })),
        { id: 'palette', label: 'Buscar · ⌘K', icon: <SparklesIcon className="h-5 w-5" />, onClick: () => setPaletteOpen(true), flavor: 'ai' },
        { id: 'more', label: 'Más', icon: <EllipsisVertical className="h-5 w-5" />, onClick: () => setMoreOpen(true) },
    ];

    // La hoja tiene sitio de sobra, así que ahí sí va el nombre largo visible.
    const systemItems: NavItem[] = SYSTEM_ITEMS
        .filter((item) => !item.permission || can(profile, item.permission))
        .map((item) => ({ id: item.id, label: item.longLabel, icon: item.icon, href: item.href }));

    return (
        <>
            <nav
                aria-label="Navegación principal (móvil)"
                className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-gray-950/95 backdrop-blur-md border-t border-gray-200 dark:border-gray-800 pb-[env(safe-area-inset-bottom,0)]"
            >
                {/* One column per destination; the count drives the grid rather than a
                    pair of hardcoded cases that would silently clip the last item. */}
                <ul className={cn('grid', GRID_COLUMNS[Math.min(items.length, 7)] ?? 'grid-cols-6')}>
                    {items.map((item) => {
                        const active = item.match ? item.match(location.pathname) : false;
                        const isAi = item.flavor === 'ai';
                        return (
                            <li key={item.id} className="flex">
                                <button
                                    type="button"
                                    aria-current={active ? 'page' : undefined}
                                    aria-label={item.name ?? item.label}
                                    onClick={() => {
                                        if (item.onClick) item.onClick();
                                        else if (item.href) navigate(item.href);
                                    }}
                                    className={cn(
                                        'relative flex flex-col items-center justify-center w-full pt-2 pb-2 gap-1 transition-colors',
                                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset',
                                        active
                                            ? 'text-primary-600 dark:text-primary-300'
                                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
                                    )}
                                >
                                    {isAi ? (
                                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-ai-gradient text-white shadow-glow-ai">
                                            <SparklesIcon className="h-4 w-4" />
                                        </span>
                                    ) : (
                                        item.icon
                                    )}
                                    {/* El registro corto, visible. El nombre
                                        accesible lo lleva `aria-label` y es el
                                        largo, como en el raíl: lo que se ve y
                                        lo que se anuncia no tienen por qué
                                        coincidir, pero sí tienen que decir lo
                                        mismo una sola vez cada uno. */}
                                    <span aria-hidden className="text-[10px] font-medium tracking-tight">{item.label}</span>
                                    {active && !isAi && (
                                        <span className="absolute top-0 left-1/2 -translate-x-1/2 h-1 w-8 rounded-b-full bg-primary-500" aria-hidden />
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            {/* The system destinations, out-of-tree until a user opens the sheet. */}
            {moreOpen && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Más opciones"
                    className="md:hidden fixed inset-0 z-[110] bg-gray-950/60 backdrop-blur-sm"
                    onClick={() => setMoreOpen(false)}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-2xl p-4 pb-[env(safe-area-inset-bottom,1rem)] shadow-pop"
                    >
                        <div className="flex items-center gap-3 mb-3">
                            <AIArchitectAvatar size="sm" />
                            <div>
                                <p className="text-sm font-semibold text-gray-900 dark:text-white">{PRODUCT_SHORT_NAME}</p>
                                <p className="text-2xs text-gray-500 dark:text-gray-400">Oficina de Arquitectura</p>
                            </div>
                        </div>
                        {/* The theme flip lives here rather than in the bar:
                            it acts on the app, it does not navigate it — the
                            same split the desktop rail makes at its foot.
                            Keyboard shortcuts are deliberately absent; there is
                            no keyboard to shortcut on a phone. */}
                        <button
                            type="button"
                            onClick={toggleTheme}
                            className="w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                            <span className="text-gray-500 dark:text-gray-400">
                                {theme === 'dark' ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
                            </span>
                            {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
                        </button>

                        {/* La ayuda va aquí y no en la barra: el pulgar tiene
                            cuatro destinos y una búsqueda, y esto se consulta,
                            no se recorre. Es la misma guía que abre el raíl. */}
                        {onOpenGuide && (
                            <button
                                type="button"
                                onClick={() => { setMoreOpen(false); onOpenGuide(); }}
                                aria-haspopup="dialog"
                                className="w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                            >
                                <span className="text-gray-500 dark:text-gray-400">
                                    <LifeBuoy className="h-5 w-5" />
                                </span>
                                Guía de uso
                            </button>
                        )}

                        {systemItems.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => { setMoreOpen(false); if (item.href) navigate(item.href); }}
                                className="w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                            >
                                <span className="text-gray-500 dark:text-gray-400">{item.icon}</span>
                                {item.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
};

export default MobileBottomNav;
