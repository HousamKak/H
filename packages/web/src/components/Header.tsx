import { useHealth } from '../hooks.js';

interface Props {
  agentCount: number;
  workingCount: number;
}

export function Header({ agentCount, workingCount }: Props) {
  const online = useHealth();

  return (
    <header className="header">
      <div className="header-logo">H // SYSTEM</div>
      <div className="header-status">
        <div className="indicator">
          <span className={`dot ${online ? 'dot-green' : 'dot-red'}`} />
          <span>{online ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
        <div className="indicator">
          <span className="dot dot-amber" />
          <span>{agentCount} AGENT{agentCount !== 1 ? 'S' : ''}</span>
        </div>
        {workingCount > 0 && (
          <div className="indicator">
            <span className="dot dot-green" style={{ animation: 'blink 1s step-end infinite' }} />
            <span>{workingCount} WORKING</span>
          </div>
        )}
      </div>
    </header>
  );
}
