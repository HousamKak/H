import { useState, useRef, useEffect } from 'react';
import type { TerminalLine } from '../hooks.js';
import type { HEvent } from '../api.js';

interface Props {
  lines: TerminalLine[];
  onSend: (input: string) => void;
  events: HEvent[];
}

// Events worth showing in the terminal — skip noisy message.received/sent
const TERMINAL_EVENT_TYPES = new Set([
  'agent.spawned', 'agent.started', 'agent.terminated', 'agent.error', 'agent.idle',
  'task.created', 'task.completed', 'task.failed', 'task.blocked',
  'session.started', 'session.paused', 'session.resumed', 'session.completed',
  'graph.created', 'graph.completed', 'graph.failed',
  'cost.threshold.warning',
  'system.started', 'system.shutdown', 'system.error',
]);

/** Strip markdown bold/header syntax for terminal display */
function stripMarkdown(text: string): string {
  return text
    .replace(/^##\s+/gm, '')      // ## headers
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold**
    .replace(/^\s{2}/gm, '  ');    // keep indentation
}

export function Terminal({ lines, onSend, events }: Props) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredEvents = events.filter(e => TERMINAL_EVENT_TYPES.has(e.type));

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines, filteredEvents]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setHistory((prev) => [...prev, trimmed]);
    setHistoryIdx(-1);
    onSend(trimmed);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
        setHistoryIdx(newIdx);
        setInput(history[newIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx >= 0) {
        const newIdx = historyIdx + 1;
        if (newIdx >= history.length) {
          setHistoryIdx(-1);
          setInput('');
        } else {
          setHistoryIdx(newIdx);
          setInput(history[newIdx]);
        }
      }
    }
  };

  return (
    <div className="terminal" onClick={() => inputRef.current?.focus()}>
      <div className="terminal-output" ref={outputRef}>
        {lines.map((line) => (
          <div key={line.id} className={`terminal-line ${line.type}`}>
            {line.type === 'response' ? stripMarkdown(line.text) : line.text}
          </div>
        ))}

        {filteredEvents.slice(-15).map((evt, i) => (
          <div key={`${evt.id}-${i}`} className="terminal-line event">
            [{new Date(evt.timestamp).toLocaleTimeString()}] {evt.type}
            {evt.agentId ? ` [${evt.agentId.substring(0, 8)}]` : ''}
          </div>
        ))}
      </div>

      <div className="terminal-prompt">
        <span className="terminal-prompt-symbol">H&gt;</span>
        <input
          ref={inputRef}
          className="terminal-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="type a command or message..."
          spellCheck={false}
          autoComplete="off"
        />
        <span className="blink" style={{ color: 'var(--green)' }}>_</span>
      </div>
    </div>
  );
}
