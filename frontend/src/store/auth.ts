import { create } from "zustand";

import { authApi } from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  initialized: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  bootstrap: () => Promise<void>;
  setUser: (user: User) => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem("df_token"),
  loading: false,
  initialized: false,

  async login(email, password) {
    set({ loading: true });
    try {
      const { token, user } = await authApi.login(email, password);
      localStorage.setItem("df_token", token);
      set({ token, user, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  async register(name, email, password) {
    set({ loading: true });
    try {
      const { token, user } = await authApi.register(name, email, password);
      localStorage.setItem("df_token", token);
      set({ token, user, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  logout() {
    localStorage.removeItem("df_token");
    set({ user: null, token: null });
  },

  async bootstrap() {
    const token = localStorage.getItem("df_token");
    if (!token) {
      set({ user: null, token: null, initialized: true });
      return;
    }
    try {
      const user = await authApi.me();
      set({ user, token, initialized: true });
    } catch (e) {
      console.error("Auth bootstrap failed", e);
      localStorage.removeItem("df_token");
      set({ user: null, token: null, initialized: true });
    }
  },

  setUser(user) {
    set({ user });
  },
}));
