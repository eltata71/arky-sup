import { useMemo, useState } from 'react';
import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
import {
  describeOperation,
  exportOperationTrace,
  type OperationTraceNode,
  type CoordinationOutcome,
} from '../../services/architectureOffice/operationTrace';

export interface OperationTracePanelProps {
  outcome: CoordinationOutcome;
}

const STATUS_KEY = {
  ok: 'trace.ok',
  failed: 'trace.failed',
  warning: 'trace.warning',
} as const;

function TraceNode({ node, depth }: { node: OperationTraceNode; depth: number }) {
  const t = useUiTranslation();
  const statusText = node.status ? t(STATUS_KEY[node.status]) : null;
  const heading = (
    <>
      {node.kind === 'rejected-handoff' ? `${t('trace.rejected')}: ` : ''}
      {node.label}
      {statusText && <span className="ml-1 font-semibold">[{statusText}]</span>}
      {node.elapsedMs !== undefined && <span className="ml-1 text-gray-400">{Math.round(node.elapsedMs)} ms</span>}
    </>
  );
  const body = (node.detail || node.prompt) && (
    <p className="whitespace-pre-wrap text-gray-500 dark:text-gray-400">
      {node.prompt && <code className="mr-1">{node.prompt}</code>}
      {node.detail}
    </p>
  );
  if (node.children.length === 0) {
    return (
      <li role="treeitem" aria-level={depth} className="py-0.5">
        <div>{heading}</div>
        {body}
      </li>
    );
  }
  return (
    <li role="treeitem" aria-level={depth} aria-expanded={depth === 1} className="py-0.5">
      <details open={depth === 1}>
        <summary className="cursor-pointer">{heading}</summary>
        {body}
        <ul role="group" className="ml-3 border-l border-gray-200 pl-2 dark:border-gray-700">
          {node.children.map((child) => (
            <TraceNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      </details>
    </li>
  );
}

export function OperationTracePanel({ outcome }: OperationTracePanelProps) {
  const t = useUiTranslation();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const tree = useMemo(() => (open ? describeOperation(outcome) : null), [open, outcome]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportOperationTrace(outcome));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-2 text-2xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="font-medium text-gray-500 underline dark:text-gray-400"
      >
        {open ? t('trace.hide') : t('trace.title')}
      </button>
      {tree && (
        <div className="mt-1 rounded-lg bg-white/70 p-2 dark:bg-gray-950/50">
          <ul role="tree" aria-label={t('trace.title')}>
            <TraceNode node={tree} depth={1} />
          </ul>
          <p className="mt-1 font-medium text-gray-600 dark:text-gray-300">
            {t('trace.stamps')}:{' '}
            {outcome.promptStamps && outcome.promptStamps.length > 0
              ? outcome.promptStamps.join(', ')
              : t('trace.noStamps')}
          </p>
          <p className="mt-1 text-gray-400">{t('trace.redactedNote')}</p>
          <button type="button" onClick={copy} className="mt-1 underline">
            {t('trace.export')}
          </button>
          {copied && <span role="status" className="ml-2">{t('trace.exported')}</span>}
        </div>
      )}
    </div>
  );
}
