/**
 * AnomalyBanner - 多台相同失败检测横幅
 *
 * 进入会话时调 /api/anomaly/check，若该机型近期出现 >= 阈值的相同错误模式，
 * 在对话区顶部弹横幅，列出错误模式 + 候选根因（testcode/装配/物料，按铁律多方向）。
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { anomalyService, type AnomalyResult } from '@/services/anomalyService';

interface AnomalyBannerProps {
  sessionId: string;
}

export function AnomalyBanner({ sessionId }: AnomalyBannerProps) {
  const [data, setData] = useState<AnomalyResult | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setData(null);
    setDismissed(false);
    anomalyService
      .check(sessionId)
      .then(setData)
      .catch(() => setData(null));
  }, [sessionId]);

  if (!data || dismissed) return null;

  return (
    <div className="mx-4 mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 shrink-0">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-amber-700">
            近 {data.days} 天机型 {data.model} 出现多台相同失败
          </div>
          <div className="text-xs text-amber-700/80 mt-1">
            以下错误模式近 {data.days} 天出现 ≥{data.threshold} 次，可能非单机问题：
          </div>
          <ul className="mt-1 space-y-0.5">
            {data.alerts.map((a, i) => (
              <li key={i} className="text-xs text-amber-700/90">
                • <span className="font-mono">{a.pattern}</span> — {a.count} 次 / {a.sessions} 个会话
              </li>
            ))}
          </ul>
          <div className="text-xs text-amber-700/80 mt-2">候选根因（按证据强弱排查，不止 testcode）：</div>
          <ul className="mt-0.5 space-y-0.5">
            {data.candidates.map((c, i) => (
              <li key={i} className="text-xs text-amber-700/90">
                • <b>{c.cause}</b>：{c.action}
              </li>
            ))}
          </ul>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="p-0.5 hover:bg-amber-500/20 rounded shrink-0"
          title="关闭"
        >
          <X size={14} className="text-amber-600" />
        </button>
      </div>
    </div>
  );
}
