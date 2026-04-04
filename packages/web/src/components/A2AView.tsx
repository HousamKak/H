import { useState, useEffect, useCallback } from 'react';
import { api, type AgentCard, type A2AMessage } from '../api.js';

interface Props {
  sessionId?: string;
}

interface Permission {
  id: string;
  fromSessionId: string;
  toSessionId: string;
  status: string;
  createdAt: string;
}

export function A2AView({ sessionId }: Props) {
  const [cards, setCards] = useState<AgentCard[]>([]);
  const [messages, setMessages] = useState<A2AMessage[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [pendingPerms, setPendingPerms] = useState<Permission[]>([]);

  const refreshCards = useCallback(() => {
    if (!sessionId) return;
    api.a2a.agents(sessionId).then(setCards).catch(() => {});
  }, [sessionId]);

  const refreshMessages = useCallback(() => {
    if (!selectedAgentId) return;
    api.a2a.messages(selectedAgentId).then(setMessages).catch(() => {});
  }, [selectedAgentId]);

  const refreshPerms = useCallback(() => {
    if (!sessionId) return;
    api.a2a.permissions.pending(sessionId).then(setPendingPerms).catch(() => {});
  }, [sessionId]);

  const handleGrant = async (id: string) => { await api.a2a.permissions.grant(id); refreshPerms(); };
  const handleDeny = async (id: string) => { await api.a2a.permissions.deny(id); refreshPerms(); };

  useEffect(() => {
    refreshCards();
    const t = setInterval(refreshCards, 3000);
    return () => clearInterval(t);
  }, [refreshCards]);

  useEffect(() => {
    refreshMessages();
    const t = setInterval(refreshMessages, 3000);
    return () => clearInterval(t);
  }, [refreshMessages]);

  useEffect(() => {
    refreshPerms();
    const t = setInterval(refreshPerms, 3000);
    return () => clearInterval(t);
  }, [refreshPerms]);

  if (!sessionId) {
    return (
      <div style={{ padding: 24, color: 'var(--text-dim)', fontFamily: 'VT323, monospace' }}>
        No active session. Start a session to see A2A communication.
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Pending cross-session permission requests */}
      {pendingPerms.length > 0 && (
        <div style={{ padding: 12, marginBottom: 12, background: '#2a1a0a', border: '1px solid #aa8800' }}>
          <div style={{ fontFamily: 'Press Start 2P, monospace', fontSize: 10, color: '#ffaa00', marginBottom: 8 }}>
            CROSS-SESSION ACCESS REQUESTS ({pendingPerms.length})
          </div>
          {pendingPerms.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
              <span style={{ color: '#aa8800' }}>From session</span>
              <span style={{ color: '#ffaa00' }}>{p.fromSessionId.slice(0, 8)}</span>
              <span style={{ color: '#666', flex: 1 }}>wants to message your agents</span>
              <button onClick={() => handleGrant(p.id)} style={{ background: '#1a3a1a', color: '#33ff33', border: '1px solid #33ff33', padding: '3px 10px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>GRANT</button>
              <button onClick={() => handleDeny(p.id)} style={{ background: 'none', color: '#aa3333', border: '1px solid #aa3333', padding: '3px 10px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>DENY</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
      {/* Agent Cards Panel */}
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border)', paddingRight: 16 }}>
        <h3 style={{ fontFamily: 'Press Start 2P, monospace', fontSize: 11, color: 'var(--green)', marginBottom: 12 }}>
          AGENT CARDS ({cards.length})
        </h3>
        {cards.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontFamily: 'VT323, monospace', fontSize: 16 }}>
            No agents registered.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cards.map(c => (
              <div
                key={c.agentId}
                onClick={() => setSelectedAgentId(c.agentId)}
                style={{
                  padding: 8,
                  border: `1px solid ${c.agentId === selectedAgentId ? 'var(--green)' : 'var(--border)'}`,
                  background: c.agentId === selectedAgentId ? '#0d1f0d' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--green)' }}>
                  {c.name}
                </div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
                  [{c.status}] {c.capabilities.join(', ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Messages Panel */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <h3 style={{ fontFamily: 'Press Start 2P, monospace', fontSize: 11, color: 'var(--green)', marginBottom: 12 }}>
          {selectedAgentId ? `MESSAGES: ${selectedAgentId.slice(0, 8)}` : 'SELECT AN AGENT'}
        </h3>
        {!selectedAgentId ? (
          <div style={{ color: 'var(--text-dim)', fontFamily: 'VT323, monospace', fontSize: 16 }}>
            Click an agent card to view its messages.
          </div>
        ) : messages.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontFamily: 'VT323, monospace', fontSize: 16 }}>
            No messages for this agent.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map(m => (
              <div key={m.id} style={{ padding: 10, border: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#aa8800' }}>
                    [{m.type}] {m.subject ?? ''}
                  </span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--text-dim)' }}>
                    {m.status} | {new Date(m.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-dim)' }}>
                  From: {m.fromAgentId.slice(0, 8)} {m.toAgentId ? `-> ${m.toAgentId.slice(0, 8)}` : '(broadcast)'}
                </div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text)', marginTop: 6, whiteSpace: 'pre-wrap' }}>
                  {m.body}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
