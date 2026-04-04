// react-mosaic layout node: either an applet ID (leaf) or a split (branch)
export type MosaicNode =
  | string
  | {
      direction: 'row' | 'column';
      first: MosaicNode;
      second: MosaicNode;
      splitPercentage?: number;
    };

export type AppletType = 'terminal';  // expand later: 'dashboard', 'blackboard', etc.

export type TerminalAppletKind = 'claude_code' | 'shell' | 'dev_server' | 'attach';

export interface TerminalAppletConfig {
  sessionId: string;
  projectId: string;
  kind: TerminalAppletKind;
  terminalId?: string;    // for attach mode
  command?: string;        // for spawn modes
  args?: string[];
  cwd?: string;
}

export interface Applet {
  id: string;
  type: AppletType;
  title?: string;
  config: TerminalAppletConfig;
}

export interface Workspace {
  id: string;
  layout: MosaicNode | null;
  applets: Applet[];
  updatedAt: string;
}

export interface UpdateWorkspaceInput {
  layout: MosaicNode | null;
  applets: Applet[];
}
