import { useMemo, useState } from 'react';
import type { TraceSpan } from '../api.js';

interface TraceViewProps {
  spans: TraceSpan[];
  title?: string;
}

const OP_COLORS: Record<string, string> = {
  llm_call: '#b388ff',   // purple
  tool_exec: '#00e5ff',   // cyan
  agent_loop: '#ffb000',  // amber
};

function getOpColor(operation: string): string {
  return OP_COLORS[operation] ?? '#b0b0b0';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

interface TreeSpan extends TraceSpan {
  depth: number;
  children: TreeSpan[];
  durationMs: number;
  offsetMs: number;
}

function buildTree(spans: TraceSpan[], globalStart: number): TreeSpan[] {
  const spanMap = new Map<string, TreeSpan>();

  // Create TreeSpan wrappers
  for (const span of spans) {
    const start = new Date(span.startTime).getTime();
    const end = span.endTime ? new Date(span.endTime).getTime() : Date.now();
    spanMap.set(span.id, {
      ...span,
      depth: 0,
      children: [],
      durationMs: end - start,
      offsetMs: start - globalStart,
    });
  }

  const roots: TreeSpan[] = [];

  // Build parent-child relationships
  for (const treeSpan of spanMap.values()) {
    if (treeSpan.parentSpanId && spanMap.has(treeSpan.parentSpanId)) {
      const parent = spanMap.get(treeSpan.parentSpanId)!;
      parent.children.push(treeSpan);
    } else {
      roots.push(treeSpan);
    }
  }

  // Set depths recursively
  function setDepth(node: TreeSpan, depth: number) {
    node.depth = depth;
    // Sort children by start time
    node.children.sort((a, b) => a.offsetMs - b.offsetMs);
    for (const child of node.children) {
      setDepth(child, depth + 1);
    }
  }
  for (const root of roots) {
    setDepth(root, 0);
  }

  // Sort roots by start time
  roots.sort((a, b) => a.offsetMs - b.offsetMs);

  return roots;
}

function flattenTree(nodes: TreeSpan[]): TreeSpan[] {
  const result: TreeSpan[] = [];
  function walk(node: TreeSpan) {
    result.push(node);
    for (const child of node.children) {
      walk(child);
    }
  }
  for (const root of nodes) {
    walk(root);
  }
  return result;
}

function SpanRow({
  span,
  totalDurationMs,
  timelineWidth,
}: {
  span: TreeSpan;
  totalDurationMs: number;
  timelineWidth: number;
}) {
  const [hovered, setHovered] = useState(false);

  const opColor = getOpColor(span.operation);
  const barLeft = totalDurationMs > 0
    ? (span.offsetMs / totalDurationMs) * timelineWidth
    : 0;
  const barWidth = totalDurationMs > 0
    ? Math.max((span.durationMs / totalDurationMs) * timelineWidth, 4)
    : timelineWidth;

  const isError = span.status === 'error';
  const totalTokens = (span.inputTokens ?? 0) + (span.outputTokens ?? 0);
  const indentPx = span.depth * 20;

  const label = span.toolName
    ? `${span.operation}(${span.toolName})`
    : span.model
      ? `${span.operation}`
      : span.operation;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '200px 1fr 80px 80px',
        gap: '8px',
        alignItems: 'center',
        padding: '4px 8px',
        background: hovered ? 'rgba(0, 255, 65, 0.04)' : 'transparent',
        borderBottom: '1px solid var(--border)',
        position: 'relative',
        minHeight: '32px',
      }}
    >
      {/* Operation Name Column */}
      <div style={{
        paddingLeft: `${indentPx}px`,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        <span style={{
          color: opColor,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '13px',
        }}>
          {label}
        </span>
        {span.model && (
          <span style={{
            color: 'var(--text-dim)',
            fontSize: '12px',
            marginLeft: '6px',
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            {span.model}
          </span>
        )}
      </div>

      {/* Timeline Bar Column */}
      <div style={{ position: 'relative', height: '20px' }}>
        <div style={{
          position: 'absolute',
          left: `${barLeft}px`,
          width: `${barWidth}px`,
          height: '100%',
          background: opColor,
          opacity: 0.7,
          borderLeft: isError ? '3px solid var(--red)' : `3px solid ${opColor}`,
          borderRight: isError ? '3px solid var(--red)' : 'none',
          boxShadow: isError
            ? '0 0 6px var(--red)'
            : hovered
              ? `0 0 8px ${opColor}`
              : 'none',
          transition: 'box-shadow 0.15s ease',
        }}>
          {/* Duration label inside bar if wide enough */}
          {barWidth > 50 && (
            <span style={{
              position: 'absolute',
              left: '6px',
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: '12px',
              fontFamily: 'JetBrains Mono, monospace',
              color: '#0a0a0a',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
            }}>
              {formatDuration(span.durationMs)}
            </span>
          )}
        </div>

        {/* Duration label outside bar if too narrow */}
        {barWidth <= 50 && (
          <span style={{
            position: 'absolute',
            left: `${barLeft + barWidth + 6}px`,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '12px',
            fontFamily: 'JetBrains Mono, monospace',
            color: 'var(--text-dim)',
            whiteSpace: 'nowrap',
          }}>
            {formatDuration(span.durationMs)}
          </span>
        )}
      </div>

      {/* Tokens Column */}
      <div style={{
        textAlign: 'right',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '13px',
        color: totalTokens > 0 ? 'var(--text)' : 'var(--text-dim)',
      }}>
        {totalTokens > 0 ? formatTokens(totalTokens) : '-'}
      </div>

      {/* Cost Column */}
      <div style={{
        textAlign: 'right',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '13px',
        color: span.costUsd ? 'var(--green)' : 'var(--text-dim)',
      }}>
        {span.costUsd ? formatCost(span.costUsd) : '-'}
      </div>

      {/* Hover Tooltip */}
      {hovered && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: `${indentPx + 16}px`,
          zIndex: 100,
          background: '#0a0a0a',
          border: '1px solid var(--green)',
          padding: '10px 14px',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '12px',
          lineHeight: '1.6',
          minWidth: '280px',
          maxWidth: '420px',
          pointerEvents: 'none',
        }}>
          <div style={{ color: opColor, fontWeight: 'bold', marginBottom: '6px' }}>
            {span.operation}
          </div>
          <div style={{ color: 'var(--text-dim)' }}>
            ID: <span style={{ color: 'var(--text)' }}>{span.id.substring(0, 12)}</span>
          </div>
          {span.traceId && (
            <div style={{ color: 'var(--text-dim)' }}>
              Trace: <span style={{ color: 'var(--text)' }}>{span.traceId.substring(0, 12)}</span>
            </div>
          )}
          {span.agentId && (
            <div style={{ color: 'var(--text-dim)' }}>
              Agent: <span style={{ color: 'var(--cyan)' }}>{span.agentId.substring(0, 12)}</span>
            </div>
          )}
          {span.model && (
            <div style={{ color: 'var(--text-dim)' }}>
              Model: <span style={{ color: 'var(--purple)' }}>{span.model}</span>
            </div>
          )}
          {span.toolName && (
            <div style={{ color: 'var(--text-dim)' }}>
              Tool: <span style={{ color: 'var(--cyan)' }}>{span.toolName}</span>
            </div>
          )}
          <div style={{ color: 'var(--text-dim)' }}>
            Duration: <span style={{ color: 'var(--text)' }}>{formatDuration(span.durationMs)}</span>
          </div>
          <div style={{ color: 'var(--text-dim)' }}>
            Status: <span style={{ color: isError ? 'var(--red)' : 'var(--green)' }}>
              {span.status}
            </span>
          </div>
          {span.inputTokens != null && (
            <div style={{ color: 'var(--text-dim)' }}>
              Input tokens: <span style={{ color: 'var(--green-dim)' }}>{formatTokens(span.inputTokens)}</span>
            </div>
          )}
          {span.outputTokens != null && (
            <div style={{ color: 'var(--text-dim)' }}>
              Output tokens: <span style={{ color: 'var(--amber)' }}>{formatTokens(span.outputTokens)}</span>
            </div>
          )}
          {span.costUsd != null && (
            <div style={{ color: 'var(--text-dim)' }}>
              Cost: <span style={{ color: 'var(--green)' }}>{formatCost(span.costUsd)}</span>
            </div>
          )}
          {span.errorMessage && (
            <div style={{ color: 'var(--red)', marginTop: '4px', wordBreak: 'break-word' }}>
              Error: {span.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TraceView({ spans, title }: TraceViewProps) {
  const { tree, flatSpans, totalDurationMs } = useMemo(() => {
    if (spans.length === 0) {
      return { tree: [], flatSpans: [], totalDurationMs: 0 };
    }
    const globalStart = Math.min(
      ...spans.map((s) => new Date(s.startTime).getTime())
    );
    const globalEnd = Math.max(
      ...spans.map((s) =>
        s.endTime ? new Date(s.endTime).getTime() : Date.now()
      )
    );
    const t = buildTree(spans, globalStart);
    return {
      tree: t,
      flatSpans: flattenTree(t),
      totalDurationMs: globalEnd - globalStart,
    };
  }, [spans]);

  // Approximate timeline area width (will be flexible via CSS grid)
  const timelineWidth = 400;

  if (spans.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header">
          <span>{title ?? 'TRACE VIEW'}</span>
        </div>
        <div className="panel-body">
          <div style={{ color: 'var(--text-dim)', padding: '24px 0', textAlign: 'center' }}>
            No trace data
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <span>{title ?? 'TRACE VIEW'}</span>
        <span style={{ color: 'var(--text-dim)' }}>
          {spans.length} SPANS | {formatDuration(totalDurationMs)}
        </span>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: '16px',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        fontSize: '13px',
        fontFamily: 'JetBrains Mono, monospace',
      }}>
        {Object.entries(OP_COLORS).map(([op, color]) => (
          <div key={op} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{
              width: '12px',
              height: '12px',
              background: color,
              opacity: 0.7,
            }} />
            <span style={{ color: 'var(--text-dim)' }}>{op}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px' }}>
          <div style={{
            width: '12px',
            height: '12px',
            border: '2px solid var(--green)',
            background: 'transparent',
          }} />
          <span style={{ color: 'var(--text-dim)' }}>ok</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{
            width: '12px',
            height: '12px',
            border: '2px solid var(--red)',
            background: 'transparent',
          }} />
          <span style={{ color: 'var(--text-dim)' }}>error</span>
        </div>
      </div>

      {/* Column Headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '200px 1fr 80px 80px',
        gap: '8px',
        padding: '6px 8px',
        borderBottom: '1px solid var(--border)',
        fontSize: '12px',
        fontFamily: 'VT323, monospace',
        color: 'var(--text-dim)',
        letterSpacing: '1px',
      }}>
        <span>OPERATION</span>
        <span>TIMELINE</span>
        <span style={{ textAlign: 'right' }}>TOKENS</span>
        <span style={{ textAlign: 'right' }}>COST</span>
      </div>

      {/* Span Rows */}
      <div className="panel-body" style={{ padding: 0, overflowX: 'auto' }}>
        {flatSpans.map((span) => (
          <SpanRow
            key={span.id}
            span={span}
            totalDurationMs={totalDurationMs}
            timelineWidth={timelineWidth}
          />
        ))}
      </div>
    </div>
  );
}
