/**
 * 复制文本到剪贴板（兼容非 HTTPS 环境）
 *
 * navigator.clipboard 仅在安全上下文（HTTPS / localhost）可用；
 * 通过局域网 IP 访问 HTTP 部署时该 API 不存在或抛错，
 * 需用临时 textarea + document.execCommand('copy') 兜底。
 *
 * @returns 是否复制成功
 */
export async function copyText(text: string): Promise<boolean> {
  // 1. 优先用现代 Clipboard API（安全上下文）
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒或失败，走兜底
    }
  }

  // 2. 兜底：临时 textarea + execCommand('copy')
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    // 放到视口外，避免页面跳动
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
