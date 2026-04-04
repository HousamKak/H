import { useState, useEffect, useCallback } from 'react';
import { api, type AgentCard, type A2AMessage } from '../api.js';

interface Props {
  sessionId?: string;
}

export function A2AView({ sessionId }: Props) {
  const [cards, setCards] = useState<AgentCard[]>([]);
  const [messages, setMessages] = useState<A2AMessage[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();

  const refreshCards = useCallback(() => {
    if (!sessionId) return;
    api.a2a.agents(sessionId).then(setCards).catch(() => {});
  }, [sessionId]);

  const refreshMessages = useCallback(() => {
    if (!selectedAgentId) return;
    api.a2a.messages(selectedAgentId).then(setMessages).catch(() => {});
  }, [selectedAgentId]);

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

  if (!sessionId) {
    return (
      <div style={{ padding: 24, color: 'var(--text-dim)', fontFamily: 'VT323, monospace' }}>
        No active session. Start a session to see A2A communication.
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: 'flex', gap: 16, height: '100%' }}>
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
  );
}
