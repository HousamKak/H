import { useState, useRef, useEffect } from 'react';
import type { TerminalLine } from '../hooks.js';
import type { HEvent } from '../api.js';

interface Props {
  lines: TerminalLine[];
  onSend: (input: string) => void;
  events: HEvent[];
}

export function Terminal({ lines, onSend, events }: Props) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines, events]);

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
            {line.text}
          </div>
        ))}

        {events.slice(-20).map((evt) => (
          <div key={evt.id} className="terminal-line event">
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
