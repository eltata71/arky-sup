/**
 * Mermaid theme initialization.
 *
 * Extracted verbatim from `ArtifactCanvas` so the diagram view (and any future
 * Mermaid-rendering surface) can initialize the professional theme without
 * pulling in the whole canvas module.
 */

/** Initialize Mermaid with the professional Arky theme for the current mode. */
export const initMermaidTheme = async (isDark: boolean): Promise<void> => {
  try {
    const mermaid = await import('mermaid');
    const themeCSS = isDark
      ? `
            /* Node styling */
            .node rect, .node polygon, .node circle, .node ellipse { rx: 8; ry: 8; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4)); }
            .node .label { font-weight: 500; }
            /* Cluster/subgraph styling */
            .cluster rect { rx: 12; ry: 12; fill: rgba(30,41,59,0.6) !important; stroke: #475569 !important; stroke-width: 1.5px; stroke-dasharray: 6 3; }
            .cluster text { fill: #94a3b8 !important; font-weight: 600; font-size: 13px; }
            /* Edge label styling */
            .edgeLabel { background-color: #1e293b; border-radius: 4px; padding: 2px 6px; font-size: 11px; }
            .edgeLabel rect { fill: #1e293b; rx: 4; ry: 4; opacity: 0.9; }
            /* Sequence diagram */
            .actor { rx: 8; ry: 8; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3)); }
            .actor-line { stroke: #475569; stroke-dasharray: 4 3; }
            .messageLine0, .messageLine1 { stroke: #818cf8; }
            .messageText { fill: #e2e8f0; font-size: 12px; }
            .note { fill: #1e293b; stroke: #6366f1; rx: 6; ry: 6; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.2)); }
            .noteText { fill: #c7d2fe; font-size: 11px; }
            .activation0, .activation1, .activation2 { fill: #312e81; stroke: #6366f1; }
            .loopText, .altText, .optText { fill: #94a3b8; font-size: 11px; font-weight: 600; }
            .loopLine, .altLine, .optLine { stroke: #475569; stroke-dasharray: 4 2; }
            .labelBox { fill: #1e293b; stroke: #6366f1; rx: 4; ry: 4; }
            .labelText { fill: #c7d2fe; }
            /* State diagram */
            .statediagram-state rect { rx: 8; ry: 8; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3)); }
            .statediagram-state .composit { fill: rgba(30,41,59,0.4); rx: 10; ry: 10; }
            .statediagram-note rect { fill: #1e293b; stroke: #6366f1; rx: 6; ry: 6; }
            .statediagram-note text { fill: #c7d2fe; font-size: 11px; }
            /* ER diagram */
            .er.entityBox { rx: 8; ry: 8; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3)); }
            .er.attributeBoxEven, .er.attributeBoxOdd { rx: 4; ry: 4; }
            /* Gantt */
            .section0, .section1 { fill: rgba(99,102,241,0.08); }
            .task { rx: 4; ry: 4; }
            .taskText { font-size: 11px; font-weight: 500; }
            .sectionTitle { font-weight: 700; font-size: 13px; }
            /* C4 diagrams */
            .person .label, .system .label, .container .label { font-weight: 600; }
            .boundaryBox { rx: 10; ry: 10; stroke-dasharray: 8 4; }
        `
      : `
            /* Node styling */
            .node rect, .node polygon, .node circle, .node ellipse { rx: 8; ry: 8; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.08)); }
            .node .label { font-weight: 500; }
            /* Cluster/subgraph styling */
            .cluster rect { rx: 12; ry: 12; fill: rgba(248,250,252,0.8) !important; stroke: #cbd5e1 !important; stroke-width: 1.5px; stroke-dasharray: 6 3; }
            .cluster text { fill: #475569 !important; font-weight: 600; font-size: 13px; }
            /* Edge label styling */
            .edgeLabel { background-color: #ffffff; border-radius: 4px; padding: 2px 6px; font-size: 11px; }
            .edgeLabel rect { fill: #ffffff; rx: 4; ry: 4; opacity: 0.95; }
            /* Sequence diagram */
            .actor { rx: 8; ry: 8; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.06)); }
            .actor-line { stroke: #cbd5e1; stroke-dasharray: 4 3; }
            .messageLine0, .messageLine1 { stroke: #6366f1; }
            .messageText { fill: #1e1b4b; font-size: 12px; }
            .note { fill: #eef2ff; stroke: #6366f1; rx: 6; ry: 6; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.04)); }
            .noteText { fill: #312e81; font-size: 11px; }
            .activation0, .activation1, .activation2 { fill: #e0e7ff; stroke: #818cf8; }
            .loopText, .altText, .optText { fill: #475569; font-size: 11px; font-weight: 600; }
            .loopLine, .altLine, .optLine { stroke: #cbd5e1; stroke-dasharray: 4 2; }
            .labelBox { fill: #eef2ff; stroke: #6366f1; rx: 4; ry: 4; }
            .labelText { fill: #312e81; }
            /* State diagram */
            .statediagram-state rect { rx: 8; ry: 8; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.06)); }
            .statediagram-state .composit { fill: rgba(248,250,252,0.6); rx: 10; ry: 10; }
            .statediagram-note rect { fill: #eef2ff; stroke: #6366f1; rx: 6; ry: 6; }
            .statediagram-note text { fill: #312e81; font-size: 11px; }
            /* ER diagram */
            .er.entityBox { rx: 8; ry: 8; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.06)); }
            .er.attributeBoxEven, .er.attributeBoxOdd { rx: 4; ry: 4; }
            /* Gantt */
            .section0, .section1 { fill: rgba(99,102,241,0.05); }
            .task { rx: 4; ry: 4; }
            .taskText { font-size: 11px; font-weight: 500; }
            .sectionTitle { font-weight: 700; font-size: 13px; }
            /* C4 diagrams */
            .person .label, .system .label, .container .label { font-weight: 600; }
            .boundaryBox { rx: 10; ry: 10; stroke-dasharray: 8 4; }
        `;

    mermaid.default.initialize({
      // `startOnLoad: true` lets Mermaid auto-scan rendered Markdown for
      // <pre><code class="language-mermaid"> blocks (used by hybrid
      // artifacts whose Markdown view embeds the diagram inline). The
      // canvas view bypasses this entirely via the deterministic
      // IR pipeline, so leaving auto-render on is a no-op there.
      startOnLoad: true,
      theme: 'base',
      // 'antiscript' strips inline event handlers / scripts injected via
      // labels while still allowing the rich themeCSS — strictly safer
      // than the previous 'loose' default for AI-authored content.
      securityLevel: 'antiscript',
      themeCSS,
      themeVariables: isDark
        ? {
            primaryColor: '#4f46e5',
            primaryTextColor: '#e2e8f0',
            primaryBorderColor: '#6366f1',
            lineColor: '#94a3b8',
            secondaryColor: '#1e293b',
            tertiaryColor: '#0f172a',
            background: '#0f172a',
            mainBkg: '#1e293b',
            nodeBorder: '#6366f1',
            clusterBkg: '#1e293b',
            clusterBorder: '#475569',
            titleColor: '#f1f5f9',
            edgeLabelBackground: '#1e293b',
            fontSize: '14px',
            fontFamily: 'Inter, system-ui, sans-serif',
          }
        : {
            primaryColor: '#6366f1',
            primaryTextColor: '#1e1b4b',
            primaryBorderColor: '#4f46e5',
            lineColor: '#64748b',
            secondaryColor: '#e0e7ff',
            tertiaryColor: '#f0f9ff',
            background: '#ffffff',
            mainBkg: '#eef2ff',
            nodeBorder: '#4f46e5',
            clusterBkg: '#f8fafc',
            clusterBorder: '#cbd5e1',
            titleColor: '#1e293b',
            edgeLabelBackground: '#ffffff',
            fontSize: '14px',
            fontFamily: 'Inter, system-ui, sans-serif',
          },
      // `cardinal` reads sharper than `basis` for architecture flows
      // (less rubber-band feel, edges hint at direction without
      //  creating optical curves between unrelated branches).
      flowchart: { htmlLabels: true, curve: 'cardinal', padding: 20, nodeSpacing: 60, rankSpacing: 90, useMaxWidth: true },
      sequence: { mirrorActors: false, messageAlign: 'center', boxMargin: 10, noteMargin: 10, actorFontSize: 14, messageFontSize: 13, noteFontSize: 12, wrap: true, width: 220 },
      gantt: { titleTopMargin: 25, barHeight: 22, barGap: 4, topPadding: 50, sectionFontSize: 14 },
      er: { layoutDirection: 'TB', minEntityWidth: 110, minEntityHeight: 80, entityPadding: 16, fontSize: 13 },
      c4: { diagramMarginY: 32, c4ShapeMargin: 18, c4ShapePadding: 12, width: 240, height: 80, wrap: true, wrapPadding: 12 },
    });
  } catch {
    // Mermaid not available, silently fail
  }
};
