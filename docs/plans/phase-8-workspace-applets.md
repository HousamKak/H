# Phase 8: Workspace + Applets (Always-On Sessions)

## Context

Refines H's session model based on actual workflow needs. Sessions become **groupings of related work** (not time periods) — multiple sessions can be active concurrently, each focused on a theme. A **workspace** is a tiled layout of **applets** (terminals first, more types later) that can reference any session/project. Adds **WebSocket terminal streaming** so the browser can spawn and interact with terminals without Tauri.

## User Model

- **Session** = always-on grouping of related work. Multiple sessions run in parallel. No pause/resume.
- **Workspace** = per-user tiled layout where you arrange **applets**.
- **Applet** = self-contained panel (first type: terminal). Can reference any session/project.
- **Terminal applet** = spawn Claude Code / shell / dev server / attach-to-existing. Streams via WebSocket.

## Decisions

- **Q1 Concurrent sessions**: unlimited
- **Q2 A2A scope**: within-session automatic; cross-session requires explicit grant
- **Q3 Workspace**: single per-user workspace (persistent layout)
- **Q4 First applet**: terminal only; add others later
- **Q5 Terminal actions**: spawn Claude Code, spawn shell, spawn dev server, attach-to-existing

---

## Architecture Changes

### 1. Always-on sessions (no pause/resume)

- `SessionStatus` becomes `'active' | 'ended'` only (remove `paused`, `abandoned`)
- Delete `pauseSession()`, `resumeSession()`, snapshot restore
- Orchestrator: `currentSessionId` → `focusedSessionId` (UI state, not runtime)
- Task assignment loop scans **all active sessions' agents**, not just the focused one
- Each agent/terminal tagged with `sessionId`, independent lifecycle

### 2. Workspace + Applets

- **Library**: `react-mosaic-component` — tiling window manager, drag/rearrange, JSON serialization
- Workspace stored as single row in DB, layout as JSON tree
- Applets identified by stable ID referenced in layout tree

### 3. WebSocket terminal streaming

- New endpoint: `/ws/terminals/:id` — bidirectional stream
- Stdout/stderr → frontend (xterm.js write)
- Stdin ← frontend (keystrokes)
- Works in browser without Tauri
- `TerminalManager` exposes `subscribe(terminalId, handler)` / `unsubscribe`

### 4. Cross-session A2A permissions

- New table `session_a2a_permissions` (from → to, status)
- A2ARouter checks on cross-session send
- MCP tool `h_a2a_request_cross_session` + approval flow
- UI: pending requests badge

---

## Data Model

```sql
-- Simplify sessions (no schema change, just status enum)
-- SessionStatus: 'active' | 'ended'

-- New workspace table (per-user)
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY DEFAULT 'default',
  layout_json TEXT NOT NULL DEFAULT '{}',
  applets_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cross-session A2A permissions
CREATE TABLE session_a2a_permissions (
  id TEXT PRIMARY KEY,
  from_session_id TEXT NOT NULL,
  to_session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','granted','denied','revoked')),
  requested_by_agent_id TEXT,
  granted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_session_id, to_session_id)
);
```

### Types

```typescript
// Workspace layout tree (react-mosaic format)
type MosaicNode =
  | string                                           // applet ID (leaf)
  | { direction: 'row' | 'column';
      first: MosaicNode; second: MosaicNode;
      splitPercentage?: number };

interface Applet {
  id: string;
  type: 'terminal';  // more types later
  config: TerminalAppletConfig;
  title?: string;
}

interface TerminalAppletConfig {
  sessionId: string;
  projectId: string;
  terminalId?: string;    // attach mode if set
  command?: string;        // spawn mode
  args?: string[];
  cwd?: string;
  kind: 'claude_code' | 'shell' | 'dev_server' | 'attach';
}

interface Workspace {
  id: string;
  layout: MosaicNode | null;
  applets: Applet[];
  updatedAt: string;
}
```

---

## Implementation Phases

### Phase A — Always-on sessions (~1 hour)

**Files to modify:**
- `packages/types/src/sessions.ts` — `SessionStatus = 'active' | 'ended'`
- `packages/session/src/session.service.ts` — remove pause/resume, add `endSession()`
- `packages/db/src/repositories/session.repository.ts` — remove `updateResumed`
- `packages/orchestrator/src/orchestrator.ts` — remove `pauseSession`/`resumeSession`, add `setFocusedSession`, `endSession`. Multi-session assignment loop.
- `packages/orchestrator/src/command-parser.ts` — remove pause/resume commands
- `packages/api/src/index.ts` — remove `/sessions/pause`, `/sessions/:id/resume`; add `/sessions/:id/end`
- `packages/web/src/components/SessionBar.tsx` — remove PAUSE button, keep END
- `packages/web/src/api.ts` — update session API client

**Verify**: Start 2 sessions, spawn agents in each, confirm they both receive task assignments.

### Phase B — WebSocket terminal streaming (~2 hours)

**Files to create:**
- WebSocket handler in API: `/ws/terminals/:id` per-terminal subscription
- `packages/web/src/hooks.ts` — `useTerminalStream(terminalId)` hook

**Files to modify:**
- `packages/terminal/src/terminal-manager.ts` — `subscribe(terminalId, handler): () => void`
- `packages/api/src/index.ts` — WS route + POST `/api/terminals/spawn` endpoint
- `packages/web/src/components/XTermPanel.tsx` — `mode: 'tauri' | 'websocket'` prop
- `packages/web/src/api.ts` — `terminals.spawn(input)`, `terminals.kill(id)`

**Verify**: From web UI, spawn a terminal, see stdout streamed in xterm.js.

### Phase C — Workspace + terminal applet (~3-4 hours)

**Files to create:**
- `packages/db/src/migrations/002_workspace.sql`
- `packages/db/src/repositories/workspace.repository.ts`
- `packages/types/src/workspace.ts`
- `packages/web/src/components/WorkspaceView.tsx` (uses react-mosaic)
- `packages/web/src/components/TerminalApplet.tsx`
- `packages/web/src/components/applets/AppletHeader.tsx`

**Files to modify:**
- `packages/db/src/schema.sql` — add workspaces table
- `packages/db/src/migrator.ts` — add workspace migration
- `packages/db/src/index.ts` — export WorkspaceRepository
- `packages/types/src/index.ts` — export workspace types
- `packages/api/src/index.ts` — GET/PUT `/api/workspace`
- `packages/web/src/App.tsx` — add workspace view route (could be default view)
- `packages/web/src/api.ts` — workspace API client
- `packages/web/src/components/Sidebar.tsx` — "WORKSPACE" nav item
- `packages/web/package.json` — add `react-mosaic-component` dependency

**TerminalApplet UX:**
- Header: session selector | project selector | spawn dropdown (Claude / Shell / Dev Server) | attach dropdown
- Body: `XTermPanel` in websocket mode (or Tauri if available)
- Auto-save layout on resize/rearrange

**Verify**: Open workspace, split horizontally, spawn 2 terminals in different sessions, see both streaming. Refresh page → layout restored.

### Phase D — Cross-session A2A permissions (~1 hour)

**Files to create:**
- `packages/db/src/migrations/003_a2a_permissions.sql`
- `packages/db/src/repositories/a2a-permissions.repository.ts`
- `packages/mcp/src/tools/a2a-permission.tools.ts` (new MCP tool)

**Files to modify:**
- `packages/db/src/schema.sql` — add session_a2a_permissions table
- `packages/a2a/src/a2a-router.ts` — check cross-session permission before send
- `packages/api/src/index.ts` — endpoints for grant/revoke/pending
- `packages/web/src/components/A2AView.tsx` — pending requests section

**Verify**: Agent in session A tries to send to session B → blocked. Request access → approve → message flows.

---

## File Inventory

### New Files (~12)
- `packages/db/src/migrations/002_workspace.sql`
- `packages/db/src/migrations/003_a2a_permissions.sql`
- `packages/db/src/repositories/workspace.repository.ts`
- `packages/db/src/repositories/a2a-permissions.repository.ts`
- `packages/types/src/workspace.ts`
- `packages/mcp/src/tools/a2a-permission.tools.ts`
- `packages/web/src/components/WorkspaceView.tsx`
- `packages/web/src/components/TerminalApplet.tsx`
- `packages/web/src/components/applets/AppletHeader.tsx`
- (WebSocket handler — inline in API index.ts)

### Modified Files (~15)
- `packages/types/src/sessions.ts`
- `packages/types/src/index.ts`
- `packages/session/src/session.service.ts`
- `packages/db/src/schema.sql`
- `packages/db/src/migrator.ts`
- `packages/db/src/index.ts`
- `packages/db/src/repositories/session.repository.ts`
- `packages/terminal/src/terminal-manager.ts`
- `packages/a2a/src/a2a-router.ts`
- `packages/orchestrator/src/orchestrator.ts`
- `packages/orchestrator/src/command-parser.ts`
- `packages/api/src/index.ts`
- `packages/web/package.json`
- `packages/web/src/App.tsx`
- `packages/web/src/api.ts`
- `packages/web/src/hooks.ts`
- `packages/web/src/components/SessionBar.tsx`
- `packages/web/src/components/Sidebar.tsx`
- `packages/web/src/components/XTermPanel.tsx`
- `packages/web/src/components/A2AView.tsx`

---

## Verification

After each phase, run: `pnpm build && pnpm --filter @h/web build` — all packages compile clean.

End-to-end test after Phase C:
1. Create two sessions ("Feature X", "Bugfix Y")
2. Open workspace, split vertical
3. Left pane: terminal applet → Claude Code in Feature X session's project
4. Right pane: terminal applet → shell in Bugfix Y session's project
5. Both stream stdout live
6. Refresh browser → layout + terminal connections restored

End-to-end test after Phase D:
1. Agent in Session A tries `h_a2a_send` targeting Session B agent → denied
2. Calls `h_a2a_request_cross_session` → permission entry created
3. UI shows pending request → user approves
4. Retry send → delivered

---

## Open Questions / Future Work

- **Multiple workspaces** (named): Phase 8 uses single workspace. If needed later, add `workspaces` table PK as UUID + `name`, add UI to switch.
- **Drag between applets**: e.g., drag a task onto a terminal to spawn an agent for it. Deferred.
- **Applet marketplace**: more types (dashboard-mini, blackboard, task-list, trace-viewer) after terminal applet proves the model.
- **Real PTY in browser**: current WebSocket mode is NOT a full PTY (no vim/TUI apps). Full PTY still requires Tauri. Could add node-pty to backend later if needed.
