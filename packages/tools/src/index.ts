export { ToolExecutor } from './tool-executor.js';
export type { ToolHandler } from './tool-executor.js';

// Built-in tool definitions and handlers
export {
  fileReadDefinition, fileReadHandler,
  fileWriteDefinition, fileWriteHandler,
  fileSearchDefinition, fileSearchHandler,
} from './builtin/file.tool.js';

export {
  bashExecuteDefinition, bashExecuteHandler,
} from './builtin/bash.tool.js';

export {
  gitStatusDefinition, gitStatusHandler,
  gitDiffDefinition, gitDiffHandler,
  gitCommitDefinition, gitCommitHandler,
} from './builtin/git.tool.js';

import type { EventBus } from '@h/events';
import { ToolExecutor } from './tool-executor.js';
import { fileReadDefinition, fileReadHandler, fileWriteDefinition, fileWriteHandler, fileSearchDefinition, fileSearchHandler } from './builtin/file.tool.js';
import { bashExecuteDefinition, bashExecuteHandler } from './builtin/bash.tool.js';
import { gitStatusDefinition, gitStatusHandler, gitDiffDefinition, gitDiffHandler, gitCommitDefinition, gitCommitHandler } from './builtin/git.tool.js';

export function createToolExecutor(eventBus: EventBus): ToolExecutor {
  const executor = new ToolExecutor(eventBus);

  // Register all built-in tools
  executor.register(fileReadDefinition, fileReadHandler);
  executor.register(fileWriteDefinition, fileWriteHandler);
  executor.register(fileSearchDefinition, fileSearchHandler);
  executor.register(bashExecuteDefinition, bashExecuteHandler);
  executor.register(gitStatusDefinition, gitStatusHandler);
  executor.register(gitDiffDefinition, gitDiffHandler);
  executor.register(gitCommitDefinition, gitCommitHandler);

  return executor;
}
