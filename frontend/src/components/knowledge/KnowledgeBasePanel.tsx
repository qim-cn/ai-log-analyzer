/**
 * 知识库侧栏面板
 * Tab: Debug 命令 | Linux
 * - Debug：从当前会话 AI 分析回复中提取诊断命令 + 说明，以黑窗口展示、点击复制
 * - Linux：硬件测试命令库
 */

import { useState, useMemo } from 'react';
import { Terminal } from 'lucide-react';
import { LinuxKnowledgePanel } from './LinuxKnowledgePanel';
import { useChatStore } from '@/stores';
import { cn, isCommandLike } from '@/utils';
import { CommandWindow } from '@/components/ui/CommandWindow';

type Tab = 'debug' | 'linux';

interface DebugCommand {
  command: string;
  description: string;
}

/** 取 content 中 index 所在行的完整文本（不含换行） */
function lineOf(content: string, index: number): string {
  const start = content.lastIndexOf('\n', index) + 1;
  let end = content.indexOf('\n', index);
  if (end < 0) end = content.length;
  return content.slice(start, end);
}

/** 清洗说明文字：去掉反引号/==/列表符号/首尾标点 */
function cleanDesc(s: string): string {
  return s
    .replace(/[`=*•]/g, '')
    .replace(/^[\s:：、,，。\-–-]+/, '')
    .replace(/[\s.。:：、,，]+$/, '')
    .trim();
}

/** 从一行里取命令前后的说明文字（优先命令后，其次命令前） */
function extractDescAround(line: string, cmd: string): string {
  const idx = line.indexOf(cmd);
  if (idx < 0) return '';
  const after = line.slice(idx + cmd.length);
  const before = line.slice(0, idx);
  return cleanDesc(after) || cleanDesc(before);
}

/** 从 AI 回复文本中提取诊断命令 + 说明 */
function extractDebugCommands(content: string): DebugCommand[] {
  const cmds: DebugCommand[] = [];
  let m: RegExpExecArray | null;

  // 1. fenced 代码块 ```lang\n...\n```：# 注释行作为下一条命令的说明
  const fenceRe = /```[a-zA-Z0-9+-]*\n?([\s\S]*?)```/g;
  while ((m = fenceRe.exec(content)) !== null) {
    const lines = m[1].split('\n');
    let pendingDesc = '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) { pendingDesc = ''; continue; }
      if (t.startsWith('#')) {
        // 注释行 -> 作为下一条命令的说明
        pendingDesc = t.replace(/^#+\s*/, '').trim();
        continue;
      }
      if (t.startsWith('//')) continue;
      if (isCommandLike(t)) {
        cmds.push({ command: t, description: pendingDesc });
        pendingDesc = '';
      }
    }
  }

  // 2. ==命令== 标记（系统提示词要求；过滤掉 ==日志行==）
  const eqRe = /==([^=\n]+)==/g;
  while ((m = eqRe.exec(content)) !== null) {
    const t = m[1].trim();
    if (t && isCommandLike(t)) {
      cmds.push({ command: t, description: extractDescAround(lineOf(content, m.index), t) });
    }
  }

  // 3. 行内反引号 `command`（本地分析用此格式）：说明取反引号段后到下一个反引号/行尾
  const inlineRe = /`([^`\n]+)`/g;
  while ((m = inlineRe.exec(content)) !== null) {
    const t = m[1].trim();
    if (!t || !isCommandLike(t)) continue;
    const line = lineOf(content, m.index);
    const segStart = line.indexOf(m[0]);
    const rest = segStart >= 0 ? line.slice(segStart + m[0].length) : '';
    const nextBt = rest.indexOf('`');
    const afterText = nextBt >= 0 ? rest.slice(0, nextBt) : rest;
    const beforeText = segStart >= 0 ? line.slice(0, segStart) : '';
    cmds.push({ command: t, description: cleanDesc(afterText) || cleanDesc(beforeText) });
  }

  // 去重保序（按 command），保留首个非空说明
  const seen = new Map<string, DebugCommand>();
  for (const c of cmds) {
    const ex = seen.get(c.command);
    if (!ex) {
      seen.set(c.command, c);
    } else if (!ex.description && c.description) {
      seen.set(c.command, { ...ex, description: c.description });
    }
  }
  return [...seen.values()];
}

interface KnowledgeBasePanelProps {
  className?: string;
}

export function KnowledgeBasePanel({ className }: KnowledgeBasePanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('debug');
  const { messages, streamingContent, streaming } = useChatStore();

  // 从当前会话的 AI 回复（含正在流式输出的内容）中提取诊断命令
  const debugCommands = useMemo(() => {
    const contents = messages
      .filter(m => m.role === 'assistant')
      .map(m => m.content);
    if (streaming && streamingContent) contents.push(streamingContent);
    return contents.flatMap(extractDebugCommands);
  }, [messages, streamingContent, streaming]);

  return (
    <div className={cn('h-full flex flex-col bg-card', className)}>
      <div className="border-b border-border">
        <div className="px-3 py-2.5 flex items-center gap-2">
          <Terminal size={15} className="text-primary" />
          <span className="font-medium text-sm">Debug 命令</span>
          {activeTab === 'debug' && debugCommands.length > 0 && (
            <span className="text-[11px] text-muted-foreground/60">{debugCommands.length} 条</span>
          )}
        </div>
        <div className="flex px-3 gap-1">
          <button
            onClick={() => setActiveTab('debug')}
            className={cn(
              'px-3 py-1.5 text-xs rounded-t-md transition-colors',
              activeTab === 'debug' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
            )}
          >Debug</button>
          <button
            onClick={() => setActiveTab('linux')}
            className={cn(
              'px-3 py-1.5 text-xs rounded-t-md transition-colors flex items-center gap-1',
              activeTab === 'linux' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
            )}
          ><Terminal size={12} />Linux</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'linux' ? (
          <div className="h-full"><LinuxKnowledgePanel /></div>
        ) : debugCommands.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-sm px-4 leading-relaxed">
            分析日志后，AI 输出的诊断命令会显示在这里，点击即可复制。
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {debugCommands.map((c, i) => (
              <DebugCommandItem
                key={`${i}-${c.command.slice(0, 20)}`}
                command={c.command}
                description={c.description}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface DebugCommandItemProps {
  command: string;
  description?: string;
}

function DebugCommandItem({ command, description }: DebugCommandItemProps) {
  return (
    <div className="space-y-0.5">
      <CommandWindow code={command} compact />
      {description && (
        <div className="text-[11px] text-muted-foreground/70 px-1 leading-relaxed">{description}</div>
      )}
    </div>
  );
}
