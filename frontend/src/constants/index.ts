/**
 * 应用常量
 */

/** 允许上传的文件类型 */
export const ALLOWED_FILE_TYPES = ['.log', '.txt', '.csv'];

/** 最大文件大小（50MB） */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** 默认 AI 模型 */
export const DEFAULT_MODEL = 'gpt-4o';

/** 常见机型建议（新建会话时可选/可自定义，用于筛选与多台相同失败检测） */
export const MODEL_SUGGESTIONS = ['7500S', '7DPC', 'R750', 'R740', 'R640', 'R650'];
