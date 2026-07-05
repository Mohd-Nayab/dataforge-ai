export type Role = "admin" | "manager" | "user";
export type DatabaseType = "json" | "sqlite" | "postgres" | "mongodb";

export interface DatabaseConfig {
  type: DatabaseType;
  url: string;
  available: DatabaseType[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface DatasetMeta {
  id: string;
  name: string;
  filename: string;
  rows: number;
  columns: number;
  created_at: string;
  updated_at: string;
  owner?: string | null;
  engine?: string | null;
}

export interface ColumnInfo {
  name: string;
  dtype: string;
}

export interface PreviewResponse {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface ColumnStat {
  name: string;
  dtype: string;
  missing: number;
  missing_pct: number;
  unique: number;
  min?: number | null;
  max?: number | null;
  mean?: number | null;
  std?: number | null;
  median?: number | null;
  top?: unknown;
  top_count?: number;
}

export interface ProfileResponse {
  rows: number;
  columns: number;
  duplicate_rows: number;
  missing_cells: number;
  missing_pct: number;
  memory_kb: number;
  columns_detail: ColumnStat[];
}

export interface ValidationIssue {
  rule: string;
  column?: string;
  severity: "info" | "warning" | "error" | "success";
  message: string;
}

export interface OverviewResponse {
  kpis: {
    rows: number;
    columns: number;
    numeric_columns: number;
    categorical_columns: number;
  };
  numeric_columns: string[];
  categorical_columns: string[];
  histogram?: { column: string; bins: { bin: string; count: number }[] } | null;
  category_breakdown?: { column: string; data: { name: string; value: number }[] } | null;
  correlation?: { columns: string[]; matrix: { x: string; y: string; value: number }[] } | null;
}

export interface ChatResponse {
  reply: string;
  action?: string | null;
  params?: Record<string, unknown>;
  data?: unknown;
}

export interface SqlResponse {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
  limit: number;
  cached?: boolean;
}

export interface MLTrainRequest {
  target: string;
  features?: string[];
  task?: "regression" | "classification";
  model_type?: string;
  test_size?: number;
}

export interface MLModel {
  id: string;
  model_id: string;
  task: "regression" | "classification";
  target: string;
  features: string[];
  numeric_features: string[];
  categorical_features: string[];
  test_size: number;
  rows_used: number;
  metrics: Record<string, number>;
}

export interface MLTrainResponse extends MLModel {}

export interface MLPredictResponse {
  rows: number;
  columns: string[];
  predictions: Record<string, unknown>[];
}

export interface ReportIssue {
  rule?: string;
  severity: "success" | "info" | "warning" | "error";
  column?: string;
  message: string;
}

export interface ReportColumnDetail {
  name: string;
  dtype: string;
  missing: number;
  missing_pct: number;
  unique: number;
  min?: number;
  max?: number;
  mean?: number;
  std?: number;
  median?: number;
  top?: unknown;
  top_count?: number;
}

export interface ReportSummary {
  rows: number;
  columns: number;
  duplicate_rows: number;
  missing_cells: number;
  missing_pct: number;
  memory_kb: number;
  numeric_columns: number;
  categorical_columns: number;
  quality_score: number;
}

export interface ReportDataset {
  id: string;
  name: string;
  filename: string;
  created_at: string;
  updated_at: string;
}

export interface ReportResponse {
  generated_at: string;
  dataset: ReportDataset;
  summary: ReportSummary;
  columns: ReportColumnDetail[];
  issues: ReportIssue[];
  issue_summary: Record<string, number>;
}

export interface ForecastPoint {
  date: string;
  value: number;
}

export interface ForecastRequest {
  date_col?: string;
  target_col?: string;
  method: "linear" | "moving_average" | "seasonal_naive";
  horizon: number;
}

export interface ForecastResponse {
  date_col: string;
  target_col?: string;
  method: string;
  horizon: number;
  historical: ForecastPoint[];
  forecast: ForecastPoint[];
}
