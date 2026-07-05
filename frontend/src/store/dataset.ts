import { create } from "zustand";

import type { DatasetMeta } from "@/lib/types";

interface DatasetState {
  active: DatasetMeta | null;
  setActive: (d: DatasetMeta | null) => void;
}

export const useDataset = create<DatasetState>((set) => ({
  active: JSON.parse(localStorage.getItem("df_active") ?? "null"),
  setActive: (d) => {
    if (d) localStorage.setItem("df_active", JSON.stringify(d));
    else localStorage.removeItem("df_active");
    set({ active: d });
  },
}));
