/**
 * Database platform entry point.
 *
 * Importing this module registers all available adapters (side-effects) and
 * exposes the DatabaseManager singleton + registry helpers. Add a new adapter
 * by importing its module here — nothing else changes.
 */
import "./adapters/sqlite.js";
import "./adapters/postgres.js";
import "./adapters/mongodb.js";

export { databaseManager, DatabaseManager } from "./core/DatabaseManager.js";
export { listDescriptors, getDescriptor, isAvailable } from "./core/registry.js";
export * as profiles from "./core/profiles.js";
export * from "./core/types.js";
