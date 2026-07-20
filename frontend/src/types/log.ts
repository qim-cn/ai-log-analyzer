export interface LogFile {
  id: string;
  session_id: string;
  filename: string;
  file_type: 'log' | 'txt' | 'csv';
  file_size: number;
  line_count: number;
  content: string | null;
  disk_path: string | null;
  summary: string | null;
  created_at: string;
  has_masking_map?: boolean;
}

export interface LogStatistics {
  total_lines: number;
  file_size_mb: number;
  time_start: string | null;
  time_end: string | null;
  level_counts: Record<string, number>;
  source_counts: Record<string, number>;
  hour_distribution: Record<string, number>;
  error_types: Record<string, number>;
  key_alerts: string[];
}
