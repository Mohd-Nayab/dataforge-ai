import axios from "axios";

import type {
  ChatResponse,
  DatabaseConfig,
  DatasetMeta,
  ForecastRequest,
  ForecastResponse,
  MLModel,
  MLTrainRequest,
  MLTrainResponse,
  MLPredictResponse,
  OverviewResponse,
  PreviewResponse,
  ProfileResponse,
  ReportResponse,
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
  async switchDatabase(type: DatabaseConfig["type"], url: string) {
    const { data } = await api.post<{ message: string; type: DatabaseConfig["type"] }>(
      "/admin/database",
      { type, url }
    );
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
  downloadReport(id: string) {
    const a = document.createElement("a");
    a.href = this.reportUrl(id);
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
  async forecast(id: string, body: ForecastRequest): Promise<ForecastResponse> {
    const { data } = await api.post<ForecastResponse>(`${D}/datasets/${id}/forecast`, body);
    return data;
  },
  exportUrl(id: string, format: "csv" | "json" | "xlsx") {
    return `${API_BASE}${D}/datasets/${id}/export?format=${format}`;
  },
  download(id: string, format: "csv" | "json" | "xlsx") {
    const a = document.createElement("a");
    a.href = this.exportUrl(id, format);
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
};
