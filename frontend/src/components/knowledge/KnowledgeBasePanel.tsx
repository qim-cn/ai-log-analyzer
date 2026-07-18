/**
 * 知识库侧栏面板
 * Tab: Debug 命令 | Linux
 * - Debug：从当前会话 AI 分析回复中提取诊断命令，点击复制
 * - Linux：硬件测试命令库
 */

import { useState, useMemo, useCallback } from 'react';
import { Terminal, Copy, Check } from 'lucide-react';
import { LinuxKnowledgePanel } from './LinuxKnowledgePanel';
import { useChatStore } from '@/stores';
import { cn } from '@/utils';

type Tab = 'debug' | 'linux';

/** 常见诊断命令前缀（用于区分 ==命令== 与 ==日志行==） */
const CMD_PREFIX = /^(sudo\s+)?(lspci|setpci|dmesg|smartctl|cat|ls|grep|find|ethtool|ip|ipmitool|dmidecode|storcli|megacli|sas|nvme|udevadm|systemctl|journalctl|modprobe|lscpu|lsblk|lsblk|fdisk|parted|mount|umount|dd|cp|mv|rm|echo|printf|awk|sed|head|tail|wc|sort|uniq|free|vmstat|iostat|mpstat|sar|perf|strace|ltrace|tcpdump|ping|nslookup|dig|curl|wget|ssh|scp|rsync|chmod|chown|systemctl|service|redfish|racadm|ssacli|hpssacli|arcconf|megacli|lspnp|lshw|hwinfo|inxi|sensors|smartctl|nvme|mdadm|zpool|zfs|xfs|tune2fs|dumpe2fs|blkid|lsmod|modinfo|dmesg|kernlog)\b/;

/** 判断文本是否像 shell 命令（而非日志行） */
function isCommandLike(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 200) return false;
  if (CMD_PREFIX.test(t)) return true;
  if (/[|&;>]/.test(t) && /\S/.test(t)) return true; // 管道/重定向
  if (/\/(sys|dev|proc|etc|var|tmp|usr|run)\//.test(t)) return true; // 系统路径
  return false;
}

/** 从 AI 回复文本中提取诊断命令 */
function extractDebugCommands(content: string): string[] {
  const cmds: string[] = [];
  let m: RegExpExecArray | null;

  // 1. fenced 代码块 ```lang\n...\n``` —— 明确是代码/命令，整行保留
  const fenceRe = /```[a-zA-Z0-9+-]*\n?([\s\S]*?)```/g;
  while ((m = fenceRe.exec(content)) !== null) {
    for (const line of m[1].split('\n')) {
      const t = line.trim();
      if (t && !t.startsWith('#') && !t.startsWith('//')) cmds.push(t);
    }
  }

  // 2. ==命令== 标记（系统提示词要求；过滤掉 ==日志行==）
  const eqRe = /==([^=\n]+)==/g;
  while ((m = eqRe.exec(content)) !== null) {
    const t = m[1].trim();
    if (t && isCommandLike(t)) cmds.push(t);
  }

  // 3. 行内反引号 `command`（本地分析用此格式）
  const inlineRe = /`([^`\n]+)`/g;
  while ((m = inlineRe.exec(content)) !== null) {
    const t = m[1].trim();
    if (t && isCommandLike(t)) cmds.push(t);
  }

  // 去重保序
  return [...new Set(cmds)];
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
          <div className="p-2 space-y-1.5">
            {debugCommands.map((cmd, i) => (
              <DebugCommandItem key={`${i}-${cmd.slice(0, 20)}`} cmd={cmd} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface DebugCommandItemProps {
  cmd: string;
}

function DebugCommandItem({ cmd }: DebugCommandItemProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默
    }
  }, [cmd]);

  return (
    <button
      onClick={handleCopy}
      className="w-full text-left group flex items-start gap-2 px-2.5 py-2 rounded-lg hover:bg-muted transition-colors"
      title="点击复制"
    >
      <span className="text-[11px] text-muted-foreground/40 font-mono pt-0.5 shrink-0 select-none">$</span>
      <code className="flex-1 min-w-0 text-xs font-mono text-foreground/90 break-all leading-relaxed">{cmd}</code>
      <span className="shrink-0 pt-0.5">
        {copied ? (
          <Check size={13} className="text-success" />
        ) : (
          <Copy size={13} className="text-muted-foreground/50 group-hover:text-primary transition-colors" />
        )}
      </span>
    </button>
  );
}
