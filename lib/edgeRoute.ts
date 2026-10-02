/**
 * An edge drawn along the route the layout engine computed (plan de
 * diagramas, 8.3d).
 *
 * ELK routes every edge orthogonally around the nodes, and until 8.3d that
 * route was computed and thrown away: the canvas took the node positions and
 * drew each edge as a generic step curve between two handles, which crosses
 * whatever lies in between. The route travels on the edge now, with the
 * positions its two nodes had when it was computed: a route is only true
 * while its nodes stay where the engine put them. Once a person drags one,
 * the canvas falls back to the ordinary curve.
 */

export interface Point {
    x: number;
    y: number;
}

export interface EdgeRoute {
    /** The polyline, from the source node's border to the target's. */
    points: Point[];
    /** Where the source and target nodes were when the route was computed. */
    sourceAt: Point;
    targetAt: Point;
}

/** How far a node may be from where the route expects it, in pixels. */
const POSITION_TOLERANCE = 1;

/** Whether the route still describes the nodes as they stand. */
export function isRouteCurrent(route: EdgeRoute | undefined, source: Point | undefined, target: Point | undefined): route is EdgeRoute {
    if (!route || route.points.length < 2 || !source || !target) return false;
    const near = (a: Point, b: Point) => Math.abs(a.x - b.x) <= POSITION_TOLERANCE && Math.abs(a.y - b.y) <= POSITION_TOLERANCE;
    return near(route.sourceAt, source) && near(route.targetAt, target);
}

/**
 * The SVG path of a polyline with rounded corners, and the point where its
 * label goes: the middle of the polyline by length, so a label sits on the
 * line it names rather than in the empty corner of its bounding box.
 */
export function routePath(points: Point[], radius = 10): { path: string; labelX: number; labelY: number } {
    const clean = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
    if (clean.length === 0) return { path: '', labelX: 0, labelY: 0 };
    const parts = [`M ${clean[0].x} ${clean[0].y}`];
    for (let i = 1; i < clean.length - 1; i++) {
        const prev = clean[i - 1];
        const corner = clean[i];
        const next = clean[i + 1];
        const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
        const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
        const r = Math.min(radius, inLen / 2, outLen / 2);
        const before = { x: corner.x - ((corner.x - prev.x) / inLen) * r, y: corner.y - ((corner.y - prev.y) / inLen) * r };
        const after = { x: corner.x + ((next.x - corner.x) / outLen) * r, y: corner.y + ((next.y - corner.y) / outLen) * r };
        parts.push(`L ${before.x} ${before.y}`, `Q ${corner.x} ${corner.y} ${after.x} ${after.y}`);
    }
    const last = clean[clean.length - 1];
    parts.push(`L ${last.x} ${last.y}`);

    const lengths = clean.slice(1).map((p, i) => Math.hypot(p.x - clean[i].x, p.y - clean[i].y));
    let remaining = lengths.reduce((a, b) => a + b, 0) / 2;
    let labelX = clean[0].x;
    let labelY = clean[0].y;
    for (let i = 0; i < lengths.length; i++) {
        if (remaining <= lengths[i] || i === lengths.length - 1) {
            const t = lengths[i] === 0 ? 0 : Math.min(1, remaining / lengths[i]);
            labelX = clean[i].x + (clean[i + 1].x - clean[i].x) * t;
            labelY = clean[i].y + (clean[i + 1].y - clean[i].y) * t;
            break;
        }
        remaining -= lengths[i];
    }
    return { path: parts.join(' '), labelX, labelY };
}
