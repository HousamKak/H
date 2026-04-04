import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';
import type { CostRecord, CostSummary } from '../api.js';

interface CostDashboardProps {
  records: CostRecord[];
  summary: CostSummary | null;
}

const DAILY_LIMIT = 10; // $10 daily limit - adjust as needed

const AGENT_COLORS: Record<string, string> = {
  coder: '#00ff41',
  reviewer: '#00e5ff',
  architect: '#b388ff',
  planner: '#ffb000',
  debugger: '#ff3333',
};

function getAgentColor(role: string): string {
  return AGENT_COLORS[role] ?? '#b0b0b0';
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function formatTokens(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return String(count);
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const tooltipStyle: React.CSSProperties = {
  backgroundColor: '#0a0a0a',
  border: '1px solid #00ff41',
  borderRadius: 0,
  padding: '8px 12px',
  fontFamily: 'VT323, monospace',
  fontSize: '16px',
  color: '#b0b0b0',
};

const tooltipLabelStyle: React.CSSProperties = {
  color: '#00ff41',
  fontFamily: 'VT323, monospace',
  fontSize: '14px',
  marginBottom: '4px',
};

export function CostDashboard({ records, summary }: CostDashboardProps) {
  const cumulativeData = useMemo(() => {
    if (records.length === 0) return [];
    const sorted = [...records].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    let cumulative = 0;
    return sorted.map((r) => {
      cumulative += r.costUsd;
      return {
        time: formatTime(r.timestamp),
        timestamp: r.timestamp,
        cost: r.costUsd,
        cumulative: parseFloat(cumulative.toFixed(4)),
      };
    });
  }, [records]);

  const agentBarData = useMemo(() => {
    if (!summary) return [];
    return Object.entries(summary.agentTotals).map(([agent, cost]) => ({
      agent,
      cost,
    }));
  }, [summary]);

  const recentRecords = useMemo(() => {
    return [...records]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 20);
  }, [records]);

  if (records.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header">
          <span>COST TRACKING</span>
        </div>
        <div className="panel-body">
          <div style={{ color: 'var(--text-dim)', padding: '24px 0', textAlign: 'center' }}>
            No cost data yet
          </div>
        </div>
      </div>
    );
  }

  const dailyTotal = summary?.daily ?? 0;
  const limitPercent = Math.min((dailyTotal / DAILY_LIMIT) * 100, 100);

  return (
    <div>
      {/* Summary Header */}
      <div className="panel">
        <div className="panel-header">
          <span>COST TRACKING</span>
          <span style={{ color: 'var(--text-dim)' }}>
            {new Date().toLocaleDateString()}
          </span>
        </div>
        <div className="panel-body">
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">DAILY TOTAL</div>
              <div
                className={`stat-value ${limitPercent > 80 ? 'red' : limitPercent > 50 ? 'amber' : 'green'}`}
                style={{ fontSize: '28px' }}
              >
                {formatCost(dailyTotal)}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">TASK TOTAL</div>
              <div className="stat-value cyan">
                {formatCost(summary?.taskTotal ?? 0)}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">RECORDS</div>
              <div className="stat-value green">{records.length}</div>
            </div>
          </div>

          {/* Daily Limit Progress Bar */}
          <div style={{ marginTop: '16px' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '14px',
              color: 'var(--text-dim)',
              marginBottom: '4px',
            }}>
              <span>DAILY LIMIT</span>
              <span>{formatCost(dailyTotal)} / {formatCost(DAILY_LIMIT)}</span>
            </div>
            <div style={{
              width: '100%',
              height: '8px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
            }}>
              <div style={{
                width: `${limitPercent}%`,
                height: '100%',
                background: limitPercent > 80
                  ? 'var(--red)'
                  : limitPercent > 50
                    ? 'var(--amber)'
                    : 'var(--green)',
                boxShadow: limitPercent > 80
                  ? '0 0 8px var(--red)'
                  : limitPercent > 50
                    ? '0 0 8px var(--amber)'
                    : '0 0 8px var(--green)',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        </div>
      </div>

      {/* Area Chart - Cumulative Cost */}
      <div className="panel">
        <div className="panel-header">
          <span>CUMULATIVE COST</span>
        </div>
        <div className="panel-body">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={cumulativeData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00ff41" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00ff41" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                tick={{ fill: '#555555', fontFamily: 'VT323', fontSize: 14 }}
                axisLine={{ stroke: '#1a1a1a' }}
                tickLine={{ stroke: '#1a1a1a' }}
              />
              <YAxis
                tick={{ fill: '#555555', fontFamily: 'VT323', fontSize: 14 }}
                axisLine={{ stroke: '#1a1a1a' }}
                tickLine={{ stroke: '#1a1a1a' }}
                tickFormatter={(v: number) => `$${v.toFixed(2)}`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                formatter={(value) => [formatCost(Number(value ?? 0)), 'Cumulative']}
              />
              <Area
                type="stepAfter"
                dataKey="cumulative"
                stroke="#00ff41"
                strokeWidth={2}
                fill="url(#costGradient)"
                dot={false}
                activeDot={{ r: 4, fill: '#00ff41', stroke: '#00ff41' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bar Chart - Cost Per Agent */}
      {agentBarData.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <span>COST BY AGENT</span>
          </div>
          <div className="panel-body">
            <ResponsiveContainer width="100%" height={Math.max(120, agentBarData.length * 40 + 40)}>
              <BarChart
                data={agentBarData}
                layout="vertical"
                margin={{ top: 8, right: 8, left: 80, bottom: 0 }}
              >
                <XAxis
                  type="number"
                  tick={{ fill: '#555555', fontFamily: 'VT323', fontSize: 14 }}
                  axisLine={{ stroke: '#1a1a1a' }}
                  tickLine={{ stroke: '#1a1a1a' }}
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                />
                <YAxis
                  type="category"
                  dataKey="agent"
                  tick={{ fill: '#555555', fontFamily: 'VT323', fontSize: 14 }}
                  axisLine={{ stroke: '#1a1a1a' }}
                  tickLine={{ stroke: '#1a1a1a' }}
                  width={70}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  formatter={(value) => [formatCost(Number(value ?? 0)), 'Cost']}
                />
                <Bar dataKey="cost" barSize={20}>
                  {agentBarData.map((entry) => (
                    <Cell key={entry.agent} fill={getAgentColor(entry.agent)} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent Cost Records Table */}
      <div className="panel">
        <div className="panel-header">
          <span>RECENT RECORDS</span>
          <span style={{ color: 'var(--text-dim)' }}>{records.length} TOTAL</span>
        </div>
        <div className="panel-body" style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '14px',
          }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['TIME', 'AGENT', 'MODEL', 'TOKENS', 'COST'].map((h) => (
                  <th key={h} style={{
                    textAlign: 'left',
                    padding: '6px 8px',
                    color: 'var(--text-dim)',
                    fontWeight: 'normal',
                    fontSize: '12px',
                    letterSpacing: '1px',
                    fontFamily: 'VT323, monospace',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentRecords.map((r) => (
                <tr
                  key={r.id}
                  style={{ borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.background =
                      'rgba(0, 255, 65, 0.04)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.background = 'transparent';
                  }}
                >
                  <td style={{ padding: '6px 8px', color: 'var(--text-dim)' }}>
                    {formatTime(r.timestamp)}
                  </td>
                  <td style={{ padding: '6px 8px', color: 'var(--cyan)' }}>
                    {r.agentId ? r.agentId.substring(0, 8) : '-'}
                  </td>
                  <td style={{ padding: '6px 8px', color: 'var(--text)' }}>
                    {r.model}
                  </td>
                  <td style={{ padding: '6px 8px', color: 'var(--text)' }}>
                    <span style={{ color: 'var(--green-dim)' }}>
                      {formatTokens(r.inputTokens)}
                    </span>
                    <span style={{ color: 'var(--text-dim)', margin: '0 4px' }}>/</span>
                    <span style={{ color: 'var(--amber-dim)' }}>
                      {formatTokens(r.outputTokens)}
                    </span>
                  </td>
                  <td style={{
                    padding: '6px 8px',
                    color: 'var(--green)',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}>
                    {formatCost(r.costUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
