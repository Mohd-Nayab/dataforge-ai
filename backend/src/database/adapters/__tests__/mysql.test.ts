import { beforeEach, describe, expect, it, vi } from "vitest";

import { MysqlAdapter } from "../mysql.js";
import type { ConnectionProfile } from "../../core/types.js";

const baseProfile: ConnectionProfile = {
  id: "p1",
  name: "test-mysql",
  type: "mysql",
  host: "localhost",
  port: 3306,
  username: "root",
  password: "secret",
  database: "dataforge",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("MySQL/MariaDB adapter", () => {
  let pool: any;
  let adapter: MysqlAdapter;

  beforeEach(() => {
    pool = {
      getConnection: vi.fn().mockResolvedValue({ release: vi.fn() }),
      end: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(),
    };
    adapter = new MysqlAdapter(baseProfile);
  });

  it("connects and disconnects", async () => {
    const createPoolSpy = vi.spyOn(adapter as any, "createMySqlPool").mockReturnValue(pool);
    await adapter.connect();
    expect(createPoolSpy).toHaveBeenCalled();
    expect(adapter.isConnected()).toBe(true);
    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
    createPoolSpy.mockRestore();
  });

  it("runs a test query and reports latency", async () => {
    const createPoolSpy = vi.spyOn(adapter as any, "createMySqlPool").mockReturnValue(pool);
    await adapter.connect();
    pool.query.mockResolvedValue([[{ version: "8.0.37" }], []]);
    const res = await adapter.test();
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Connected to MySQL/);
    expect(res.serverInfo?.version).toBe("8.0.37");
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    createPoolSpy.mockRestore();
  });

  it("executes a SELECT and maps rows", async () => {
    const createPoolSpy = vi.spyOn(adapter as any, "createMySqlPool").mockReturnValue(pool);
    await adapter.connect();
    pool.query.mockResolvedValue([[{ id: 1, name: "Alice" }], [{ name: "id" }, { name: "name" }]]);
    const res = await adapter.executeQuery("SELECT * FROM users WHERE id = ?", [1]);
    expect(res.rows).toEqual([{ id: 1, name: "Alice" }]);
    expect(res.rowCount).toBe(1);
    expect(res.fields).toEqual(["id", "name"]);
    createPoolSpy.mockRestore();
  });

  it("throws AdapterNotConnectedError when querying without connection", async () => {
    await expect(adapter.executeQuery("SELECT 1")).rejects.toThrow(/not connected/);
  });
});
