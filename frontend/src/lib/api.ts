import axios from "axios";

import type {
  AdapterDescriptor,
  ChatResponse,
  ClusterResponse,
  ConnectionProfile,
  ConnectionProfilePublic,
  ConnectionTestResult,
  DatabaseConfig,
  DatasetMeta,
  EnterpriseProfileResponse,
  EnterpriseValidationReport,
  ForecastRequest,
  ForecastResponse,
  FuzzyDuplicateResult,
  InsightsResponse,
  JoinRequest,
  JoinResponse,
  ManagerStatus,
  MLModel,
  MLTrainRequest,
  MLTrainResponse,
  MLPredictResponse,
  OutlierReportResponse,
  OverviewResponse,
  PreviewResponse,
  ProfileResponse,
  QueryPlan,
  QueryResult,
  ReportResponse,
  SchemaSnapshot,
  SmartCleanResult,
  SqlResponse,
  User,
  ValidationIssue,
} from "./types";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("df_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      const token = localStorage.getItem("df_token");
      if (token) {
        localStorage.removeItem("df_token");
        if (window.location.pathname !== "/login" && window.location.pathname !== "/register") {
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  }
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _triggerBlobDownload(res: any, fallbackName: string) {
  const cd: string = res.headers?.["content-disposition"] || "";
  const match = cd.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? fallbackName;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ----------------------------------------------------------------- auth
export const authApi = {
  async register(name: string, email: string, password: string) {
    const { data } = await api.post<{ token: string; user: User }>(
      "/auth/register",
      { name, email, password }
    );
    return data;
  },
  async login(email: string, password: string) {
    const { data } = await api.post<{ token: string; user: User }>("/auth/login", {
      email,
      password,
    });
    return data;
  },
  async me() {
    const { data } = await api.get<{ user: User }>("/auth/me");
    return data.user;
  },
  async listUsers() {
    const { data } = await api.get<{ users: User[] }>("/admin/users");
    return data.users;
  },
  async updateRole(id: string, role: User["role"]) {
    const { data } = await api.patch<{ user: User }>(`/admin/users/${id}/role`, { role });
    return data.user;
  },
  async updateProfile(name: string) {
    const { data } = await api.patch<{ user: User }>("/auth/me", { name });
    return data.user;
  },
  async changePassword(currentPassword: string, newPassword: string) {
    const { data } = await api.post<{ message: string }>("/auth/password", {
      currentPassword,
      newPassword,
    });
    return data;
  },
  async getDatabaseConfig() {
    const { data } = await api.get<DatabaseConfig>("/admin/database");
    return data;
  },
  async switchDatabase(
    type: DatabaseConfig["type"],
    url: string,
    options: { migrate?: boolean } = {}
  ) {
    const { data } = await api.post<{
      message: string;
      type: DatabaseConfig["type"];
      migrated: boolean;
      usersMigrated: number;
      metaMigrated: number;
    }>("/admin/database", {
      type,
      url,
      migrate: options.migrate !== false,
    });
    return data;
  },
};

// ---------------------------------------------------------- database platform
export const databaseApi = {
  async getSupported(): Promise<{ databases: AdapterDescriptor[] }> {
    const { data } = await api.get<{ databases: AdapterDescriptor[] }>("/database/supported");
    return data;
  },
  async getStatus(): Promise<ManagerStatus> {
    const { data } = await api.get<ManagerStatus>("/database/status");
    return data;
  },
  async listProfiles(): Promise<{ profiles: ConnectionProfilePublic[]; activeId: string | null }> {
    const { data } = await api.get<{ profiles: ConnectionProfilePublic[]; activeId: string | null }>(
      "/database/profiles"
    );
    return data;
  },
  async createProfile(body: Partial<ConnectionProfile>): Promise<ConnectionProfilePublic> {
    const { data } = await api.post<{ profile: ConnectionProfilePublic }>("/database/profiles", body);
    return data.profile;
  },
  async updateProfile(
    id: string,
    body: Partial<ConnectionProfile>
  ): Promise<ConnectionProfilePublic> {
    const { data } = await api.patch<{ profile: ConnectionProfilePublic }>(`/database/profiles/${id}`, body);
    return data.profile;
  },
  async deleteProfile(id: string): Promise<void> {
    await api.delete(`/database/profiles/${id}`);
  },
  async testProfile(
    id?: string,
    body?: Partial<ConnectionProfile>
  ): Promise<ConnectionTestResult> {
    const { data } = await api.post<ConnectionTestResult>("/database/test", body ?? {}, {
      params: id ? { id } : undefined,
    });
    return data;
  },
  async switchTo(id: string): Promise<{ message: string; status: ManagerStatus }> {
    const { data } = await api.post<{ message: string; status: ManagerStatus }>(`/database/switch/${id}`);
    return data;
  },
  async disconnect(): Promise<{ status: ManagerStatus }> {
    const { data } = await api.post<{ status: ManagerStatus }>("/database/disconnect");
    return data;
  },
  async discoverSchema(): Promise<SchemaSnapshot> {
    const { data } = await api.get<SchemaSnapshot>("/database/schema");
    return data;
  },
  async executeQuery<T = Record<string, unknown>>(plan: QueryPlan): Promise<QueryResult<T>> {
    const { data } = await api.post<QueryResult<T>>("/database/query", plan);
    return data;
  },
  async insert(target: string, docs: Record<string, unknown>[]): Promise<{ inserted: number }> {
    const { data } = await api.post<{ inserted: number }>("/database/insert", { target, docs });
    return data;
  },
};

// ----------------------------------------------------------------- data
const D = "/data";
const API_BASE = import.meta.env.VITE_API_URL || "/api";

export const dataApi = {
  async upload(file: File, engine: "pandas" | "polars" | "dask" = "pandas", onProgress?: (pct: number) => void) {
    const form = new FormData();
    form.append("file", file);
    form.append("engine", engine);
    const { data } = await api.post<DatasetMeta>(`${D}/datasets/upload`, form, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
    return data;
  },
  async saveDatasetMeta(meta: DatasetMeta) {
    const { data } = await api.post<{ dataset: DatasetMeta }>("/datasets/meta", meta);
    return data.dataset;
  },
  async listDatasetMeta() {
    const { data } = await api.get<{ datasets: DatasetMeta[] }>("/datasets/meta");
    return data.datasets;
  },
  async deleteDatasetMeta(id: string) {
    await api.delete(`/datasets/meta/${id}`);
  },
  async list() {
    const { data } = await api.get<DatasetMeta[]>(`${D}/datasets`);
    return data;
  },
  async get(id: string) {
    const { data } = await api.get<DatasetMeta>(`${D}/datasets/${id}`);
    return data;
  },
  async remove(id: string) {
    await api.delete(`${D}/datasets/${id}`);
    // Best-effort cleanup of Node-side metadata mirror.
    await api.delete(`/datasets/meta/${id}`).catch(() => undefined);
  },
  async undo(id: string) {
    const { data } = await api.post<DatasetMeta>(`${D}/datasets/${id}/undo`);
    return data;
  },
  async preview(
    id: string,
    params: {
      page?: number;
      page_size?: number;
      search?: string;
      sort_by?: string;
      sort_dir?: string;
    }
  ) {
    const { data } = await api.get<PreviewResponse>(`${D}/datasets/${id}/preview`, {
      params,
    });
    return data;
  },
  async stats(id: string) {
    const { data } = await api.get<ProfileResponse>(`${D}/datasets/${id}/stats`);
    return data;
  },
  async enterpriseProfile(id: string) {
    const { data } = await api.get<EnterpriseProfileResponse>(`${D}/datasets/${id}/profile`);
    return data;
  },
  async validate(id: string) {
    const { data } = await api.get<{ issues: ValidationIssue[] }>(
      `${D}/datasets/${id}/validate`
    );
    return data.issues;
  },
  async clean(id: string, operation: string, params: Record<string, unknown> = {}) {
    const { data } = await api.post<{ message: string; meta: DatasetMeta }>(
      `${D}/datasets/${id}/clean`,
      { operation, params }
    );
    return data;
  },
  async smartClean(id: string, dryRun = false) {
    const { data } = await api.post<SmartCleanResult>(
      `${D}/datasets/${id}/smart-clean`,
      { dry_run: dryRun }
    );
    return data;
  },
  async getAuditLog(id: string) {
    const { data } = await api.get<{ audit_log: SmartCleanResult["audit_log"] }>(
      `${D}/datasets/${id}/audit-log`
    );
    return data.audit_log;
  },
  async enterpriseValidate(id: string) {
    const { data } = await api.get<EnterpriseValidationReport>(
      `${D}/datasets/${id}/enterprise-validate`
    );
    return data;
  },
  async fuzzyDuplicates(id: string, threshold = 0.85) {
    const { data } = await api.get<FuzzyDuplicateResult>(
      `${D}/datasets/${id}/fuzzy-duplicates`, { params: { threshold } }
    );
    return data;
  },
  async outlierReport(id: string) {
    const { data } = await api.get<OutlierReportResponse>(
      `${D}/datasets/${id}/outlier-report`
    );
    return data;
  },
  async autoClean(id: string) {
    const { data } = await api.post<{ log: string[]; meta: DatasetMeta }>(
      `${D}/datasets/${id}/auto-clean`
    );
    return data;
  },
  async overview(id: string) {
    const { data } = await api.get<OverviewResponse>(`${D}/datasets/${id}/overview`);
    return data;
  },
  async analytics(id: string, body: Record<string, unknown>) {
    const { data } = await api.post(`${D}/datasets/${id}/analytics`, body);
    return data;
  },
  async chat(id: string, message: string) {
    const { data } = await api.post<ChatResponse>(`${D}/datasets/${id}/chat`, {
      message,
    });
    return data;
  },
  async sql(id: string, query: string, limit = 1000): Promise<SqlResponse> {
    const { data } = await api.post<SqlResponse>(`${D}/datasets/${id}/sql`, { query, limit });
    return data;
  },
  async trainModel(id: string, body: MLTrainRequest): Promise<MLTrainResponse> {
    const { data } = await api.post<MLTrainResponse>(`${D}/datasets/${id}/ml/train`, body);
    return data;
  },
  async predictModel(id: string, modelId: string): Promise<MLPredictResponse> {
    const { data } = await api.post<MLPredictResponse>(`${D}/datasets/${id}/ml/predict`, { model_id: modelId });
    return data;
  },
  async listModels(id: string): Promise<MLModel[]> {
    const { data } = await api.get<MLModel[]>(`${D}/datasets/${id}/ml/models`);
    return data;
  },
  async deleteModel(id: string, modelId: string): Promise<void> {
    await api.delete(`${D}/datasets/${id}/ml/models/${modelId}`);
  },
  async getReport(id: string): Promise<ReportResponse> {
    const { data } = await api.get<ReportResponse>(`${D}/datasets/${id}/report`);
    return data;
  },
  reportUrl(id: string) {
    return `${API_BASE}${D}/datasets/${id}/report/download`;
  },
  async downloadReport(id: string) {
    const res = await api.get(this.reportUrl(id), { responseType: "blob" });
    _triggerBlobDownload(res, "report.html");
  },
  async forecast(id: string, body: ForecastRequest): Promise<ForecastResponse> {
    const { data } = await api.post<ForecastResponse>(`${D}/datasets/${id}/forecast`, body);
    return data;
  },
  async insights(id: string, maxInsights = 12): Promise<InsightsResponse> {
    const { data } = await api.get<InsightsResponse>(`${D}/datasets/${id}/insights`, {
      params: { max_insights: maxInsights },
    });
    return data;
  },
  async join(id: string, body: JoinRequest): Promise<JoinResponse> {
    const { data } = await api.post<JoinResponse>(`${D}/datasets/${id}/join`, body);
    return data;
  },
  async cluster(
    id: string,
    body: { features?: string[]; n_clusters?: number; apply?: boolean }
  ): Promise<ClusterResponse> {
    const { data } = await api.post<ClusterResponse>(`${D}/datasets/${id}/ml/cluster`, body);
    return data;
  },
  exportUrl(id: string, format: "csv" | "json" | "xlsx") {
    return `${API_BASE}${D}/datasets/${id}/export?format=${format}`;
  },
  async download(id: string, format: "csv" | "json" | "xlsx") {
    const res = await api.get(this.exportUrl(id, format), { responseType: "blob" });
    const ext = format === "xlsx" ? "xlsx" : format;
    _triggerBlobDownload(res, `dataset.${ext}`);
  },
  enterpriseReportUrl(id: string, format: "html" | "xlsx") {
    return `${API_BASE}${D}/datasets/${id}/enterprise-report/download?format=${format}`;
  },
  async downloadEnterpriseReport(id: string, format: "html" | "xlsx") {
    const res = await api.get(this.enterpriseReportUrl(id, format), { responseType: "blob" });
    const ext = format === "xlsx" ? "xlsx" : "html";
    _triggerBlobDownload(res, `enterprise_report.${ext}`);
  },
};
