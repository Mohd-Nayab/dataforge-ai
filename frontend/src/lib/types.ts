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

export interface QualityScores {
  completeness: number;
  consistency: number;
  validity: number;
  accuracy: number;
  uniqueness: number;
  integrity: number;
  overall: number;
}

export interface EnterpriseColumnStat extends ColumnStat {
  pandas_dtype: string;
  semantic_type: string;
  semantic_confidence: number;
  duplicate_count: number;
  uniqueness_ratio: number;
  entropy?: number | null;
  sentinel_missing_pct: number;
  date_parse_ratio?: number;
  variance?: number | null;
  mode?: number | unknown;
  outlier_count_zscore?: number;
  pattern_signature?: string;
  top_pct?: number;
  min_length?: number;
  max_length?: number;
  mean_length?: number;
}

export interface EnterpriseProfileResponse extends ProfileResponse {
  total_cells: number;
  duplicate_pct: number;
  memory_mb: number;
  quality_scores: QualityScores;
  columns_detail: EnterpriseColumnStat[];
  correlation_matrix: Record<string, Record<string, number>>;
  sample_size: number;
  generated_at: string;
}

export interface ValidationIssue {
  rule: string;
  column?: string;
  severity: "info" | "warning" | "error" | "success";
  message: string;
}

export interface AuditEntry {
  timestamp: string;
  column: string;
  row_index: number;
  old_value: unknown;
  new_value: unknown;
  method: string;
  confidence: number;
  reason: string;
}

export interface SmartCleanResult {
  summary: string;
  rows_before: number;
  rows_after: number;
  cells_changed: number;
  halted: boolean;
  halt_reason: string;
  audit_log: AuditEntry[];
  meta?: DatasetMeta;
}

export interface ValidationIssueDetail {
  rule: string;
  column: string;
  severity: "info" | "warning" | "error";
  message: string;
  count?: number;
  percentage?: number;
}

export interface EnterpriseValidationReport {
  total_issues: number;
  issues: ValidationIssueDetail[];
  column_reports: Record<string, {
    issues: ValidationIssueDetail[];
    issue_count: number;
    missing: number;
    missing_pct: number;
  }>;
  overall_quality: number;
}

export interface FuzzyDuplicateGroup {
  row_indices: number[];
  similarity_score: number;
  key_columns: string[];
  suggested_action: string;
}

export interface FuzzyDuplicateResult {
  groups: FuzzyDuplicateGroup[];
  total_potential_duplicates: number;
  summary: string;
}

export interface OutlierColumnReport {
  iqr: { count: number; bounds: [number, number] | null };
  zscore: { count: number; threshold: number };
  modified_zscore: { count: number; threshold: number };
  total_unique_outliers: number;
}

export interface OutlierReportResponse {
  column_reports: Record<string, OutlierColumnReport>;
  total_outliers: number;
  summary: string;
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

export interface InsightItem {
  id: string;
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
  metric?: Record<string, unknown>;
}

export interface InsightsResponse {
  summary: string;
  insight_count: number;
  insights: InsightItem[];
}

export interface JoinRequest {
  right_id: string;
  left_on: string;
  right_on: string;
  how?: "inner" | "left" | "right" | "outer";
  suffixes?: string[];
  name?: string;
}

export interface JoinResponse {
  meta: DatasetMeta;
  message: string;
  how: string;
  left_on: string;
  right_on: string;
  left_rows: number;
  right_rows: number;
  result_rows: number;
  sample: Record<string, unknown>[];
}

export interface ClusterCenter {
  cluster: number;
  size: number;
  means: Record<string, number>;
}

export interface ClusterResponse {
  n_clusters: number;
  features: string[];
  rows_used: number;
  inertia: number;
  silhouette: number | null;
  cluster_sizes: Record<string, number>;
  centers: ClusterCenter[];
  applied: boolean;
  sample_labels: number[];
  meta?: DatasetMeta;
}

// ----------------------------------------------------------------- Database Platform

export type SupportedDatabase =
  | "sqlite"
  | "postgres"
  | "mysql"
  | "mariadb"
  | "sqlserver"
  | "oracle"
  | "mongodb"
  | "redis"
  | "elasticsearch"
  | "pinecone"
  | "chromadb"
  | "weaviate"
  | "qdrant"
  | "milvus"
  | "faiss";

export type DatabaseFamily = "relational" | "document" | "key_value" | "search" | "vector";

export interface DatabaseCapabilities {
  family: DatabaseFamily;
  sql: boolean;
  documents: boolean;
  transactions: boolean;
  indexes: boolean;
  vectorSearch: boolean;
}

export interface AdapterDescriptor {
  type: SupportedDatabase;
  label: string;
  capabilities: DatabaseCapabilities;
  status: "available" | "planned";
  requiredFields: ("host" | "port" | "username" | "password" | "database" | "options")[];
  defaultPort?: number;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  type: SupportedDatabase;
  host?: string;
  port?: number;
  username?: string;
  /** Sent only in create/update requests, never returned. */
  password?: string;
  database?: string;
  ssl?: boolean;
  authMethod?: string;
  options?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionProfilePublic extends Omit<ConnectionProfile, "password"> {
  hasPassword: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  serverInfo?: Record<string, unknown>;
}

export interface SchemaObject {
  name: string;
  type: "table" | "view" | "collection" | "index";
  columns?: { name: string; dataType: string; nullable?: boolean }[];
  rowCount?: number;
}

export interface SchemaSnapshot {
  database?: string;
  objects: SchemaObject[];
  discoveredAt: string;
}

export interface ManagerStatus {
  activeProfileId: string | null;
  activeType: SupportedDatabase | null;
  connected: boolean;
  pooledProfiles: string[];
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
  fields?: string[];
  raw?: unknown;
}
