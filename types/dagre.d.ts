/**
 * Minimal ambient declaration for `dagre`.
 *
 * The package ships no types and `@types/dagre` is not installed, so under
 * `strict` every layout call in `lib/layoutEngine.ts` is an implicit `any` —
 * which is exactly the thing the strict boundary exists to catch, reported
 * against a dependency rather than against our code. Declaring the surface we
 * actually use is smaller than adding a dependency and more honest than
 * silencing the error.
 *
 * It sits in `types/` rather than beside `lib/layoutEngine.ts` because an
 * ambient declaration for a third-party package belongs to no module of ours,
 * and because `tsconfig.strict.json` has to list it explicitly: a strict probe
 * that does not pull it in reports the dependency as an implicit `any`.
 */
declare module 'dagre' {
  namespace graphlib {
    class Graph {
      constructor(options?: { multigraph?: boolean; compound?: boolean; directed?: boolean });
      setGraph(config: Record<string, unknown>): void;
      setDefaultEdgeLabel(callback: () => Record<string, unknown>): void;
      setNode(id: string, label: Record<string, unknown>): void;
      setEdge(from: string, to: string, label?: Record<string, unknown>, name?: string): void;
      setParent(id: string, parentId: string): void;
      hasNode(id: string): boolean;
      node(id: string): { x: number; y: number; width: number; height: number } | undefined;
      // dagre accepts either the three positional ends or a single edge object;
      // `lib/layoutEngine.ts` tries both because a multigraph edge is only
      // found by the form that carries its name.
      edge(from: string, to: string, name?: string): Record<string, unknown> | undefined;
      edge(edge: { v: string; w: string; name?: string }): Record<string, unknown> | undefined;
      nodes(): string[];
      edges(): Array<{ v: string; w: string }>;
      graph(): { width?: number; height?: number };
    }
  }
  function layout(graph: graphlib.Graph): void;
}
