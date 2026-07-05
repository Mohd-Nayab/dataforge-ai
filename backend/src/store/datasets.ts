import { config } from "../config.js";
import {
  createDatasetRepository,
  type DatasetMeta,
  type DatasetRepository,
} from "../db/datasets.js";

export type { DatasetMeta } from "../db/datasets.js";

class DatasetStore {
  constructor(private repo: DatasetRepository) {}

  async init() {
    try {
      await this.repo.init();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `Failed to initialize dataset metadata store for "${config.databaseType}", falling back to JSON:`,
        err instanceof Error ? err.message : err
      );
      this.repo = createDatasetRepository("json");
      await this.repo.init();
    }
  }

  saveMeta(meta: DatasetMeta): Promise<DatasetMeta> {
    return this.repo.saveMeta(meta);
  }

  listMeta(): Promise<DatasetMeta[]> {
    return this.repo.listMeta();
  }

  deleteMeta(id: string): Promise<void> {
    return this.repo.deleteMeta(id);
  }

  setRepo(repo: DatasetRepository) {
    this.repo = repo;
  }
}

export const datasetStore = new DatasetStore(createDatasetRepository());
