/**
 * Modal - Portal 化的居中弹窗
 *
 * 必须用 createPortal 渲染到 document.body，脱离调用方的祖先链。
 * 原因：ChatPanel 头部/输入区用了 backdrop-blur-sm，而 backdrop-filter 会让该元素
 * 成为 position:fixed 后代的包含块，导致 fixed 弹窗不再相对视口、而是相对那个
 * 100px 高的小条--弹窗塞进去看不到也不居中。Portal 到 body 可彻底规避。
 *
 * 体容器带 min-h-0，保证内容长了在弹窗内滚动、头/脚始终可见。
 */

import { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxW?: string;
  /** 是否允许关闭（保存中设 false 会隐藏 X、禁用遮罩点击） */
  closable?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxW = 'max-w-2xl',
  closable = true,
}: ModalProps) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => closable && onClose()}
      />
      <div
        className={cn(
          'relative bg-card border border-border rounded-2xl shadow-lg w-full max-h-[88vh] flex flex-col',
          maxW
        )}
      >
        {(title || closable) && (
          <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
            <div>
              {title && <h3 className="font-semibold text-sm">{title}</h3>}
              {subtitle && (
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">{subtitle}</p>
              )}
            </div>
            {closable && (
              <button onClick={onClose} className="p-1 hover:bg-muted rounded">
                <X size={14} className="text-muted-foreground" />
              </button>
            )}
          </div>
        )}

        {/* min-h-0 必须有，否则内容长了会把弹窗撑过视口、底部按钮被推出屏幕 */}
        <div className="px-5 pb-3 space-y-3 overflow-y-auto flex-1 min-h-0">{children}</div>

        {footer && (
          <div className="px-5 py-4 border-t border-border shrink-0">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}
