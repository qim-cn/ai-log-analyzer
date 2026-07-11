/**
 * Toast 通知组件
 * 替代 alert()，支持自动消失和多种类型
 */

import { useState, useCallback, createContext, useContext } from 'react';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { cn } from '@/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = `toast-${Date.now()}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLES = {
  success: 'border-success/30 bg-success/10 text-success',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  info: 'border-primary/30 bg-primary/10 text-primary',
};

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const Icon = ICONS[toast.type];

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-xl border shadow-surface-lg',
        'pointer-events-auto animate-slide-up backdrop-blur-sm',
        'bg-card/95',
        STYLES[toast.type]
      )}
    >
      <Icon size={16} className="shrink-0" />
      <span className="text-sm flex-1">{toast.message}</span>
      <button
        onClick={onClose}
        className="shrink-0 p-0.5 hover:bg-muted rounded transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}
