/**
 * 对话命令面板
 * 从当前会话的 assistant 消息（含流式输出中的内容）提取可执行命令，
 * 每条带说明和复制按钮。
 *
 * 提取规则：
 * 1. ```bash / ```sh / ```shell / ```zsh / ```console / ```command 围栏代码块
 *    -> 整块作为一条（多行脚本保持整体一条复制）；
 * 2. 无语言标记的围栏代码块，内容里有任一行像 shell 命令 -> 整块提取；
 * 3. 行内 `code` 里像命令的 -> 提取。
 * 说明：取代码块/行内代码前面最近的一句非空文本；没有则显示"（无说明）"。
 */

import { useMemo, useState, useCallback } from 'react';
import { Terminal, Copy, Check } from 'lucide-react';
import { useChatStore } from '@/stores';
import { cn, copyText, isCommandLike } from '@/utils';

interface ConvCommand {
  command: string;
  description: string;
}

/** shell 类围栏语言标记（空串 = 无语言标记，另行判断内容） */
const SHELL_FENCE_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'command', '']);

/** isCommandLike 之外补充的常见命令前缀（docker/kubectl/ps/df 等） */
const EXTRA_CMD_PREFIX =
  /^(sudo\s+)?(docker|kubectl|ps|netstat|ss|top|htop|df|du|kill|killall|apt|apt-get|yum|dnf|pip|pip3|npm|node|python|python3)\b/;

/** 判断文本是否像 shell 命令（共享规则 + 面板补充前缀） */
function looksLikeCommand(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return isCommandLike(t) || EXTRA_CMD_PREFIX.test(t);
}

/** 清洗说明文字：去掉 markdown 标记/列表符号/首尾标点 */
function cleanDesc(s: string): string {
  return s
    .replace(/[`*]/g, '')
    .replace(/==/g, '')
    .replace(/^#+\s*/, '')
    .replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, '')
    .replace(/^[\s:：、,，。\-–—]+/, '')
    .replace(/[\s.。:：、,，]+$/, '')
    .trim()
    .slice(0, 80);
}

/**
 * 取 content 中 index 位置之前最近的一句说明文字。
 * 若前面处于另一个围栏代码块内部，则认为没有说明。
 */
function descBefore(content: string, index: number): string {
  const before = content.slice(0, index);
  // 前面有奇数个 ``` -> index 处在某个代码块内部
  const fenceCount = (before.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) return '';
  const lines = before.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const desc = cleanDesc(lines[i]);
    if (desc) return desc;
  }
  return '';
}

/** 从一段 assistant 消息文本中提取命令 + 说明 */
function extractConversationCommands(content: string): ConvCommand[] {
  const cmds: ConvCommand[] = [];
  let m: RegExpExecArray | null;

  // 1. 围栏代码块
  const fenceRe = /```([a-zA-Z0-9+-]*)[ \t]*\n?([\s\S]*?)```/g;
  while ((m = fenceRe.exec(content)) !== null) {
    const lang = m[1].toLowerCase();
    const body = m[2].trim();
    if (!body || !SHELL_FENCE_LANGS.has(lang)) continue;
    // 无语言标记的块：至少有一行像命令才收
    if (lang === '' && !body.split('\n').some((l) => looksLikeCommand(l))) continue;
    cmds.push({ command: body, description: descBefore(content, m.index) });
  }

  // 2. 行内 `code`
  const inlineRe = /`([^`\n]+)`/g;
  while ((m = inlineRe.exec(content)) !== null) {
    const t = m[1].trim();
    if (!t || !looksLikeCommand(t)) continue;
    cmds.push({ command: t, description: descBefore(content, m.index) });
  }

  // 去重保序（按 command），保留首个非空说明
  const seen = new Map<string, ConvCommand>();
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

export function ConversationCommandsPanel() {
  const { messages, streaming, streamingContent } = useChatStore();

  // 当前会话的 assistant 消息（含正在流式输出的内容）-> 命令列表
  const commands = useMemo(() => {
    const contents = messages
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content);
    if (streaming && streamingContent) contents.push(streamingContent);
    const seen = new Map<string, ConvCommand>();
    for (const c of contents.flatMap(extractConversationCommands)) {
      const ex = seen.get(c.command);
      if (!ex) seen.set(c.command, c);
      else if (!ex.description && c.description) {
        seen.set(c.command, { ...ex, description: c.description });
      }
    }
    return [...seen.values()];
  }, [messages, streaming, streamingContent]);

  return (
    <div className="h-full flex flex-col bg-card">
      <div className="border-b border-border px-3 py-2.5 flex items-center gap-2">
        <Terminal size={15} className="text-primary" />
        <span className="font-medium text-sm">对话命令</span>
        {commands.length > 0 && (
          <span className="text-[11px] text-muted-foreground/60">
            {commands.length} 条
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {commands.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-sm px-4 leading-relaxed">
            AI 回复中出现的命令会显示在这里，点击即可复制。
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {commands.map((c, i) => (
              <CommandItem
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

function CommandItem({
  command,
  description,
}: {
  command: string;
  description: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (await copyText(command)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [command]);

  return (
    <div className="border border-border rounded-lg p-2.5">
      <div className="flex items-start gap-2">
        {/* 命令主体（多行脚本整体一条） */}
        <div
          className={cn(
            'flex-1 min-w-0 font-mono text-[11px] leading-relaxed',
            'whitespace-pre-wrap break-all text-foreground/90'
          )}
        >
          {command}
        </div>
        <button
          onClick={handleCopy}
          className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="复制命令"
        >
          {copied ? (
            <Check size={13} className="text-success" />
          ) : (
            <Copy size={13} />
          )}
        </button>
      </div>
      <div className="text-[11px] text-muted-foreground/70 mt-1 leading-relaxed">
        {description || '（无说明）'}
      </div>
    </div>
  );
}
