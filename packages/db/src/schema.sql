-- H Assistant Database Schema

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================================
-- Projects
-- ============================================================================
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'paused', 'archived')),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Agent Definitions (role schemas)
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_definitions (
  role TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  llm_provider TEXT NOT NULL DEFAULT 'claude',
  model TEXT,
  max_concurrent_tasks INTEGER NOT NULL DEFAULT 1,
  temperature REAL NOT NULL DEFAULT 0.7,
  token_budget INTEGER NOT NULL DEFAULT 100000,
  max_turns INTEGER NOT NULL DEFAULT 50,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Agent Instances (running agents)
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_instances (
  id TEXT PRIMARY KEY,
  definition_role TEXT NOT NULL,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'spawning'
    CHECK(status IN ('spawning','idle','working','paused','terminated','error')),
  current_task_id TEXT,
  token_budget INTEGER NOT NULL DEFAULT 100000,
  turn_count INTEGER NOT NULL DEFAULT 0,
  spawned_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
  terminated_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (definition_role) REFERENCES agent_definitions(role),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- ============================================================================
-- Tasks
-- ============================================================================
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  parent_task_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','assigned','in_progress','review',
                     'completed','failed','blocked','cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK(priority IN ('critical','high','medium','low')),
  required_role TEXT NOT NULL DEFAULT 'coder',
  assigned_agent_id TEXT,
  dependencies_json TEXT NOT NULL DEFAULT '[]',
  subtasks_json TEXT NOT NULL DEFAULT '[]',
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (parent_task_id) REFERENCES tasks(id),
  FOREIGN KEY (assigned_agent_id) REFERENCES agent_instances(id)
);

-- ============================================================================
-- Events (append-only event store)
-- ============================================================================
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  project_id TEXT,
  agent_id TEXT,
  task_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,
  correlation_id TEXT,
  causation_id TEXT
);

-- ============================================================================
-- Memory Records
-- ============================================================================
CREATE TABLE IF NOT EXISTS memory_records (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  agent_id TEXT,
  type TEXT NOT NULL
    CHECK(type IN ('fact','decision','pattern','preference','context','error_lesson')),
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  importance REAL NOT NULL DEFAULT 0.5,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

-- ============================================================================
-- Conversations
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  agent_id TEXT,
  task_id TEXT,
  interface_source TEXT NOT NULL DEFAULT 'system'
    CHECK(interface_source IN ('telegram','api','cli','system','websocket')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','agent','system','tool')),
  agent_id TEXT,
  content TEXT NOT NULL,
  tool_calls_json TEXT,
  tool_results_json TEXT,
  token_count INTEGER,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- ============================================================================
-- Tool Registry
-- ============================================================================
CREATE TABLE IF NOT EXISTS tool_registry (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  input_schema_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'builtin'
    CHECK(source IN ('builtin','mcp','plugin')),
  mcp_server_url TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_agents_project ON agent_instances(project_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agent_instances(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id);
CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_memory_project ON memory_records(project_id);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_records(type);
CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory_records(importance);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
