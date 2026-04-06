// Canvas viewport (pan/zoom state)
export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export type AppletType = 'terminal' | 'session';

// Shell variants for terminal applets
export type ShellType = 'cmd' | 'powershell' | 'pwsh' | 'bash' | 'git-bash' | 'wsl';

export type TerminalAppletKind = 'shell' | 'claude' | 'super_claude' | 'dev_server' | 'attach';

export interface TerminalAppletConfig {
  sessionId: string;
  projectId: string;
  kind: TerminalAppletKind;
  shellType?: ShellType;   // which shell (only for kind='shell')
  terminalId?: string;     // for attach mode or once spawned
  command?: string;        // for spawn modes
  args?: string[];
  cwd?: string;
}

export interface SessionAppletConfig {
  sessionId: string;
  label?: string;
}

export interface Applet {
  id: string;
  type: AppletType;
  title?: string;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  parentId?: string;       // React Flow parent node (for session grouping)
  config: TerminalAppletConfig | SessionAppletConfig;
}

export interface Workspace {
  id: string;
  layout: CanvasViewport | null;
  applets: Applet[];
  updatedAt: string;
}

export interface UpdateWorkspaceInput {
  layout: CanvasViewport | null;
  applets: Applet[];
}
