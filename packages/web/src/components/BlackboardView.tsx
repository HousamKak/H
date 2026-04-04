import { useState, useMemo } from 'react';
import type { BlackboardEntry } from '../api.js';

interface BlackboardViewProps {
  entries: BlackboardEntry[];
  onResolve: (id: string) => void;
}

const typeBadgeColors: Record<string, string> = {
  hypothesis: 'var(--purple)',
  decision: 'var(--green)',
  blocker: 'var(--red)',
  discovery: 'var(--cyan)',
  test_result: 'var(--amber)',
  review_comment: 'var(--text-dim)',
};

const ALL_TYPES = [
  'hypothesis',
  'decision',
  'blocker',
  'discovery',
  'test_result',
  'review_comment',
] as const;

type ResolvedFilter = 'all' | 'active' | 'resolved';

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function BlackboardView({ entries, onResolve }: BlackboardViewProps) {
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [resolvedFilter, setResolvedFilter] = useState<ResolvedFilter>('all');

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (resolvedFilter === 'active' && e.resolved) return false;
      if (resolvedFilter === 'resolved' && !e.resolved) return false;
      return true;
    });
  }, [entries, typeFilter, resolvedFilter]);

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg-input)',
    color: 'var(--text)',
    border: '1px solid var(--border-bright)',
    fontFamily: 'var(--font-terminal)',
    fontSize: '16px',
    padding: '4px 8px',
    outline: 'none',
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <span>BLACKBOARD</span>
        <span style={{ color: 'var(--text-dim)' }}>{filtered.length} entries</span>
      </div>

      {/* Filter bar */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <label style={{ color: 'var(--text-dim)', fontSize: '14px' }}>TYPE:</label>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="all">ALL</option>
          {ALL_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.toUpperCase().replace('_', ' ')}
            </option>
          ))}
        </select>

        <label style={{ color: 'var(--text-dim)', fontSize: '14px' }}>STATUS:</label>
        <select
          value={resolvedFilter}
          onChange={(e) => setResolvedFilter(e.target.value as ResolvedFilter)}
          style={selectStyle}
        >
          <option value="all">ALL</option>
          <option value="active">ACTIVE</option>
          <option value="resolved">RESOLVED</option>
        </select>
      </div>

      <div className="panel-body">
        {filtered.length === 0 ? (
          <div
            style={{
              color: 'var(--text-dim)',
              textAlign: 'center',
              padding: '32px',
            }}
          >
            {entries.length === 0 ? 'Blackboard is clear.' : 'No entries match current filters.'}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '12px',
            }}
          >
            {filtered.map((entry) => (
              <BlackboardCard key={entry.id} entry={entry} onResolve={onResolve} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BlackboardCard({
  entry,
  onResolve,
}: {
  entry: BlackboardEntry;
  onResolve: (id: string) => void;
}) {
  const badgeColor = typeBadgeColors[entry.type] ?? 'var(--text-dim)';
  const isResolved = entry.resolved;

  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        padding: '12px',
        opacity: isResolved ? 0.5 : 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {/* Type badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            display: 'inline-block',
            padding: '1px 8px',
            fontSize: '12px',
            border: `1px solid ${badgeColor}`,
            color: badgeColor,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            fontFamily: 'var(--font-terminal)',
          }}
        >
          {entry.type.replace('_', ' ')}
        </span>
        {isResolved && (
          <span
            style={{
              fontSize: '12px',
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}
          >
            RESOLVED
          </span>
        )}
      </div>

      {/* Content */}
      <div
        style={{
          color: 'var(--text-bright)',
          fontSize: '16px',
          fontFamily: 'var(--font-terminal)',
          lineHeight: '1.4',
          flex: 1,
        }}
      >
        {entry.content}
      </div>

      {/* Confidence bar */}
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '12px',
            color: 'var(--text-dim)',
            marginBottom: '2px',
          }}
        >
          <span>CONFIDENCE</span>
          <span>{Math.round(entry.confidence * 100)}%</span>
        </div>
        <div
          style={{
            width: '100%',
            height: '4px',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              width: `${entry.confidence * 100}%`,
              height: '100%',
              background: 'var(--green)',
              boxShadow: '0 0 4px var(--green)',
            }}
          />
        </div>
      </div>

      {/* Footer: agent, timestamp, resolve */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '13px',
          color: 'var(--text-dim)',
        }}
      >
        <div style={{ display: 'flex', gap: '12px' }}>
          <span title={entry.agentId} style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
            {entry.agentId.substring(0, 8)}
          </span>
          <span>{formatTimestamp(entry.createdAt)}</span>
        </div>
        {!isResolved && (
          <button
            className="btn"
            style={{ fontSize: '12px', padding: '1px 8px' }}
            onClick={() => onResolve(entry.id)}
          >
            RESOLVE
          </button>
        )}
      </div>
    </div>
  );
}
