import type { ToolDefinition } from '@h/types';
import type { ToolHandler } from '../tool-executor.js';
import { bashExecuteHandler } from './bash.tool.js';

export const gitStatusDefinition: ToolDefinition = {
  name: 'git_status',
  description: 'Get git status of the working directory',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  source: 'builtin',
  isEnabled: true,
};

export const gitStatusHandler: ToolHandler = async (_args, context) => {
  return bashExecuteHandler({ command: 'git status --porcelain' }, context);
};

export const gitDiffDefinition: ToolDefinition = {
  name: 'git_diff',
  description: 'Get git diff of staged and unstaged changes',
  inputSchema: {
    type: 'object',
    properties: {
      staged: { type: 'boolean', description: 'Show only staged changes' },
    },
  },
  source: 'builtin',
  isEnabled: true,
};

export const gitDiffHandler: ToolHandler = async (args, context) => {
  const cmd = args.staged ? 'git diff --cached' : 'git diff';
  return bashExecuteHandler({ command: cmd }, context);
};

export const gitCommitDefinition: ToolDefinition = {
  name: 'git_commit',
  description: 'Stage files and create a git commit',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Commit message' },
      files: { type: 'array', items: { type: 'string' }, description: 'Files to stage (default: all)' },
    },
    required: ['message'],
  },
  source: 'builtin',
  isEnabled: true,
};

export const gitCommitHandler: ToolHandler = async (args, context) => {
  const files = (args.files as string[]) ?? ['.'];
  const message = args.message as string;
  const stageCmd = `git add ${files.map((f) => `"${f}"`).join(' ')}`;
  const commitCmd = `git commit -m "${message.replace(/"/g, '\\"')}"`;
  return bashExecuteHandler({ command: `${stageCmd} && ${commitCmd}` }, context);
};
