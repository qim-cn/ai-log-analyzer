/**
 * 命令识别与聊天 markdown 预处理
 *
 * AI 回复里用 ==命令== 标记诊断命令、==日志内容== 标记日志关键字段。
 * isCommandLike 用来区分二者；preprocessChatMarkdown 把 ==命令== 转成
 * ```command 代码块（由 CommandWindow 渲染成黑色可复制窗口），把 ==其它==
 * 转成加粗，避免原样显示 == 等号。
 */

/** 常见诊断命令前缀（命中即视为命令而非日志行） */
export const CMD_PREFIX = /^(sudo\s+)?(lspci|setpci|dmesg|smartctl|cat|ls|grep|find|ethtool|ip|ipmitool|dmidecode|storcli|megacli|sas|nvme|udevadm|systemctl|journalctl|modprobe|lscpu|lsblk|fdisk|parted|mount|umount|dd|cp|mv|rm|echo|printf|awk|sed|head|tail|wc|sort|uniq|free|vmstat|iostat|mpstat|sar|perf|strace|ltrace|tcpdump|ping|nslookup|dig|curl|wget|ssh|scp|rsync|chmod|chown|service|redfish|racadm|ssacli|hpssacli|arcconf|lspnp|lshw|hwinfo|inxi|sensors|mdadm|zpool|zfs|xfs|tune2fs|dumpe2fs|blkid|lsmod|modinfo|kernlog)\b/;

/** 判断文本是否像 shell 命令（而非日志行） */
export function isCommandLike(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 200) return false;
  if (CMD_PREFIX.test(t)) return true;
  if (/[|&;>]/.test(t) && /\S/.test(t)) return true; // 管道/重定向
  if (/\/(sys|dev|proc|etc|var|tmp|usr|run)\//.test(t)) return true; // 系统路径
  return false;
}

/**
 * 预处理聊天 markdown：
 * - ==命令== (isCommandLike) -> ```command 块```，由 CommandWindow 渲染成黑色窗口
 * - ==其它== (日志/高亮) -> **加粗**，避免原样显示 == 等号
 */
export function preprocessChatMarkdown(content: string): string {
  return content.replace(/==([^=\n]+)==/g, (_full, inner: string) => {
    const t = inner.trim();
    if (isCommandLike(t)) {
      return `\n\n\`\`\`command\n${t}\n\`\`\`\n\n`;
    }
    return `**${t}**`;
  });
}
