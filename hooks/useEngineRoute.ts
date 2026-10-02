import { useStore } from 'reactflow';
import { isRouteCurrent, routePath, type EdgeRoute } from '../lib/edgeRoute';

/**
 * The path of an edge along the route the layout engine computed (plan de
 * diagramas 8.3d), or `null` when there is none or it no longer holds: a
 * route is true only while both nodes stay where the engine put them, so a
 * node someone dragged gets the ordinary curve back.
 */
export const useEngineRoute = (route: EdgeRoute | undefined, source: string, target: string) => {
    const sourceAt = useStore((s) => s.nodeInternals.get(source)?.position);
    const targetAt = useStore((s) => s.nodeInternals.get(target)?.position);
    return isRouteCurrent(route, sourceAt, targetAt) ? routePath(route.points) : null;
};
