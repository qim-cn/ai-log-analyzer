/**
 * CreateSessionDialog —— 新建对话弹窗（共享组件）
 *
 * Sidebar 与 MainLayout EmptyState 两个入口共用，统一机型/SN 输入体验。
 */

import { useState } from 'react';
import { useSessionStore } from '@/stores';
import { Modal } from '@/components/ui/Modal';

interface CreateSessionDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreateSessionDialog({ open, onClose }: CreateSessionDialogProps) {
  const createSession = useSessionStore((s) => s.createSession);
  const [model, setModel] = useState('');
  const [sn, setSn] = useState('');

  const handleCreate = async () => {
    await createSession(undefined, model.trim() || undefined, sn.trim() || undefined);
    setModel('');
    setSn('');
    onClose();
  };

  const handleCancel = () => {
    setModel('');
    setSn('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title="新建对话"
      subtitle="可选填机型/SN，便于筛选和追溯"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={handleCancel}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:shadow-glow active:scale-95 transition-all"
          >
            创建
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">机型</label>
          <input
            list="model-suggestions"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="如 7500S（可自定义）"
            className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">机器 SN</label>
          <input
            value={sn}
            onChange={(e) => setSn(e.target.value)}
            placeholder="可选"
            className="w-full px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>
    </Modal>
  );
}
