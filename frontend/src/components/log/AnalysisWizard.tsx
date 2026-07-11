/**
 * AnalysisWizard - 交互式分析向导
 *
 * 引导式问题排查流程，智能推荐下一步操作
 */

import { useState } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  CheckCircle,
  AlertTriangle,
  Search,
  Lightbulb,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/utils/cn';

interface WizardStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  options: WizardOption[];
}

interface WizardOption {
  id: string;
  label: string;
  description: string;
  nextStep?: string;
  action?: () => void;
}

interface AnalysisWizardProps {
  onSendMessage?: (message: string) => void;
  onClose?: () => void;
}

const WIZARD_STEPS: WizardStep[] = [
  {
    id: 'start',
    title: '问题类型',
    description: '请选择您遇到的问题类型',
    icon: <Search className="h-5 w-5" />,
    options: [
      {
        id: 'crash',
        label: '应用崩溃',
        description: '应用程序意外终止或无响应',
        nextStep: 'crash_details',
      },
      {
        id: 'performance',
        label: '性能问题',
        description: '响应慢、超时、资源占用高',
        nextStep: 'performance_details',
      },
      {
        id: 'error',
        label: '错误日志',
        description: '看到 ERROR、FATAL 等错误信息',
        nextStep: 'error_details',
      },
      {
        id: 'other',
        label: '其他问题',
        description: '其他类型的日志问题',
        nextStep: 'other_details',
      },
    ],
  },
  {
    id: 'crash_details',
    title: '崩溃详情',
    description: '请描述崩溃的具体情况',
    icon: <AlertTriangle className="h-5 w-5" />,
    options: [
      {
        id: 'oom',
        label: '内存溢出 (OOM)',
        description: '看到 OutOfMemoryError 或内存不足',
        nextStep: 'recommendation',
        action: () => {},
      },
      {
        id: 'stack_overflow',
        label: '栈溢出',
        description: '看到 StackOverflowError',
        nextStep: 'recommendation',
        action: () => {},
      },
      {
        id: 'null_pointer',
        label: '空指针异常',
        description: '看到 NullPointerException',
        nextStep: 'recommendation',
        action: () => {},
      },
      {
        id: 'unknown_crash',
        label: '不确定原因',
        description: '需要进一步分析',
        nextStep: 'recommendation',
        action: () => {},
      },
    ],
  },
  {
    id: 'performance_details',
    title: '性能详情',
    description: '请描述性能问题的具体表现',
    icon: <AlertTriangle className="h-5 w-5" />,
    options: [
      {
        id: 'slow_response',
        label: '响应缓慢',
        description: 'API 响应时间过长',
        nextStep: 'recommendation',
      },
      {
        id: 'high_cpu',
        label: 'CPU 占用高',
        description: 'CPU 使用率持续偏高',
        nextStep: 'recommendation',
      },
      {
        id: 'high_memory',
        label: '内存占用高',
        description: '内存使用率持续偏高',
        nextStep: 'recommendation',
      },
      {
        id: 'timeout',
        label: '请求超时',
        description: '频繁出现超时错误',
        nextStep: 'recommendation',
      },
    ],
  },
  {
    id: 'error_details',
    title: '错误详情',
    description: '请描述错误的具体情况',
    icon: <AlertTriangle className="h-5 w-5" />,
    options: [
      {
        id: 'database',
        label: '数据库错误',
        description: '连接失败、查询超时等',
        nextStep: 'recommendation',
      },
      {
        id: 'network',
        label: '网络错误',
        description: '连接拒绝、DNS 解析失败等',
        nextStep: 'recommendation',
      },
      {
        id: 'auth',
        label: '认证错误',
        description: '登录失败、Token 过期等',
        nextStep: 'recommendation',
      },
      {
        id: 'other_error',
        label: '其他错误',
        description: '需要查看具体日志',
        nextStep: 'recommendation',
      },
    ],
  },
  {
    id: 'other_details',
    title: '问题详情',
    description: '请描述您遇到的问题',
    icon: <Search className="h-5 w-5" />,
    options: [
      {
        id: 'log_analysis',
        label: '日志分析',
        description: '需要分析日志内容',
        nextStep: 'recommendation',
      },
      {
        id: 'pattern_search',
        label: '模式搜索',
        description: '查找特定的日志模式',
        nextStep: 'recommendation',
      },
      {
        id: 'comparison',
        label: '日志对比',
        description: '对比不同时间的日志',
        nextStep: 'recommendation',
      },
      {
        id: 'general',
        label: '一般问题',
        description: '其他问题',
        nextStep: 'recommendation',
      },
    ],
  },
  {
    id: 'recommendation',
    title: '推荐操作',
    description: '基于您的选择，推荐以下操作',
    icon: <Lightbulb className="h-5 w-5" />,
    options: [
      {
        id: 'ask_ai',
        label: '询问 AI',
        description: '让 AI 分析日志并提供建议',
        action: () => {},
      },
      {
        id: 'view_similar',
        label: '查看相似问题',
        description: '搜索历史相似问题的解决方案',
        action: () => {},
      },
      {
        id: 'view_timeline',
        label: '查看时间线',
        description: '查看错误发生的时间分布',
        action: () => {},
      },
      {
        id: 'view_knowledge',
        label: '查看知识图谱',
        description: '查看错误模式和解决方案',
        action: () => {},
      },
    ],
  },
];

export const AnalysisWizard: React.FC<AnalysisWizardProps> = ({
  onSendMessage,
  onClose,
}) => {
  const [currentStepId, setCurrentStepId] = useState('start');
  const [selectedPath, setSelectedPath] = useState<string[]>([]);
  const [completed, setCompleted] = useState(false);

  const currentStep = WIZARD_STEPS.find((s) => s.id === currentStepId);

  const handleOptionClick = (option: WizardOption) => {
    setSelectedPath([...selectedPath, option.id]);

    if (option.action) {
      option.action();
    }

    if (option.nextStep) {
      setCurrentStepId(option.nextStep);
    }

    if (currentStepId === 'recommendation') {
      setCompleted(true);
    }
  };

  const handleBack = () => {
    if (selectedPath.length > 0) {
      const newPath = selectedPath.slice(0, -1);
      setSelectedPath(newPath);

      // 找到上一步
      const prevStep = WIZARD_STEPS.find((step) =>
        step.options.some((opt) => opt.id === newPath[newPath.length - 1])
      );
      if (prevStep) {
        setCurrentStepId(prevStep.id);
      }
    }
  };

  const handleAskAI = () => {
    const pathLabels = selectedPath.map((id) => {
      for (const step of WIZARD_STEPS) {
        const option = step.options.find((o) => o.id === id);
        if (option) return option.label;
      }
      return id;
    });

    const message = `我遇到了问题，请帮我分析：\n${pathLabels.join(' > ')}`;
    onSendMessage?.(message);
    onClose?.();
  };

  if (!currentStep) {
    return null;
  }

  return (
    <div className="flex flex-col h-full bg-card border border-border rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          {currentStep.icon}
          <h3 className="font-medium">{currentStep.title}</h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        )}
      </div>

      {/* 路径指示器 */}
      {selectedPath.length > 0 && (
        <div className="px-4 py-2 border-b border-border">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {selectedPath.map((id, index) => {
              const label = WIZARD_STEPS.flatMap((s) => s.options).find(
                (o) => o.id === id
              )?.label;
              return (
                <span key={index} className="flex items-center gap-1">
                  {index > 0 && <ChevronRight className="h-3 w-3" />}
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* 内容 */}
      <div className="flex-1 overflow-auto p-4">
        <p className="text-sm text-muted-foreground mb-4">
          {currentStep.description}
        </p>

        <div className="space-y-2">
          {currentStep.options.map((option) => (
            <button
              key={option.id}
              onClick={() => handleOptionClick(option)}
              className={cn(
                'w-full flex items-start gap-3 p-3 rounded-lg border border-border text-left',
                'hover:bg-accent hover:border-accent-foreground/20 transition-colors',
                selectedPath.includes(option.id) && 'bg-accent border-primary'
              )}
            >
              <div className="mt-0.5">
                {selectedPath.includes(option.id) ? (
                  <CheckCircle className="h-5 w-5 text-primary" />
                ) : (
                  <div className="h-5 w-5 rounded-full border-2 border-muted-foreground" />
                )}
              </div>
              <div>
                <div className="font-medium">{option.label}</div>
                <div className="text-sm text-muted-foreground">
                  {option.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="flex items-center justify-between p-4 border-t border-border">
        <button
          onClick={handleBack}
          disabled={selectedPath.length === 0}
          className={cn(
            'flex items-center gap-1 px-3 py-1.5 text-sm rounded-md',
            selectedPath.length === 0
              ? 'text-muted-foreground cursor-not-allowed'
              : 'hover:bg-muted'
          )}
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>

        {completed && (
          <button
            onClick={handleAskAI}
            className="flex items-center gap-2 px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            <MessageSquare className="h-4 w-4" />
            Ask AI
          </button>
        )}
      </div>
    </div>
  );
};
