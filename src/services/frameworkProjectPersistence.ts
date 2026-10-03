import type { FrameworkProject } from "./frameworkGenerator";

export interface FrameworkProjectSaveOptions {
  projectId?: string;
  name?: string;
  targetUrl?: string;
}

export interface FrameworkProjectRecord extends FrameworkProject {
  projectId: string;
  name: string;
  targetUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FrameworkProjectReference {
  projectId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface FrameworkProjectStorageOptions {
  baseDir?: string;
  storageKeyPrefix?: string;
  activeProjectStorageKey?: string;
}

function createProjectId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID().replace(/-/g, "");
  }
  return `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeName(name?: string, fallback = "framework-project"): string {
  const value = (name ?? fallback).trim();
  return value || fallback;
}

async function readNodeFs() {
  if (typeof window !== "undefined") {
    return null;
  }
  try {
    return await import("node:fs");
  } catch {
    return null;
  }
}

async function readNodePath() {
  if (typeof window !== "undefined") {
    return null;
  }
  try {
    return await import("node:path");
  } catch {
    return null;
  }
}

export class FrameworkProjectStorage {
  private readonly baseDir?: string;
  private readonly storageKeyPrefix: string;
  private readonly activeProjectStorageKey: string;

  constructor(options: FrameworkProjectStorageOptions = {}) {
    this.baseDir = options.baseDir;
    this.storageKeyPrefix = options.storageKeyPrefix ?? "framework-project:";
    this.activeProjectStorageKey =
      options.activeProjectStorageKey ?? "playwright-studio-active-framework-project-id";
  }

  /**
   * The "active" project -- whichever one was last explicitly saved or
   * loaded, restored automatically on next startup. Deliberately a single
   * separate record, not derived from list()'s updatedAt ordering: a
   * project merely existing in storage (even one saved more recently by
   * some other flow) must never become active on its own, only an
   * explicit save() or load() call does that. Persisted the same way a
   * saved project itself is (browser localStorage vs. Node fs via
   * baseDir), so it is restorable across a real browser refresh and
   * directly unit-testable via the Node path, same as save/load/list.
   */
  async getActiveProjectId(): Promise<string | null> {
    const storage = await this.getStorageBackend();
    if (storage.kind === "browser") {
      return storage.localStorage.getItem(this.activeProjectStorageKey);
    }

    const fs = await readNodeFs();
    const nodePath = await readNodePath();
    if (!fs || !nodePath) {
      return null;
    }
    const dir = this.baseDir ?? nodePath.resolve(process.cwd(), ".framework-projects");
    const activeFilePath = nodePath.join(dir, "active-project.json");
    if (!fs.existsSync(activeFilePath)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(activeFilePath, "utf8");
      const parsed = JSON.parse(raw) as { projectId?: string };
      return parsed.projectId ?? null;
    } catch {
      return null;
    }
  }

  /** Pass null to clear (e.g. starting a fresh recording, or clearing the
   * session -- a brand new recording has no active saved project until it
   * is itself explicitly saved). */
  async setActiveProjectId(projectId: string | null): Promise<void> {
    const storage = await this.getStorageBackend();
    if (storage.kind === "browser") {
      if (projectId) {
        storage.localStorage.setItem(this.activeProjectStorageKey, projectId);
      } else {
        storage.localStorage.removeItem(this.activeProjectStorageKey);
      }
      return;
    }

    const fs = await readNodeFs();
    const nodePath = await readNodePath();
    if (!fs || !nodePath) {
      return;
    }
    const dir = this.baseDir ?? nodePath.resolve(process.cwd(), ".framework-projects");
    const activeFilePath = nodePath.join(dir, "active-project.json");
    if (projectId) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(activeFilePath, JSON.stringify({ projectId }), "utf8");
    } else if (fs.existsSync(activeFilePath)) {
      fs.rmSync(activeFilePath, { force: true });
    }
  }

  async save(
    project: FrameworkProject,
    options: FrameworkProjectSaveOptions = {},
  ): Promise<FrameworkProjectRecord> {
    const projectId = options.projectId ?? createProjectId();
    const name = normalizeName(options.name, `framework-${projectId}`);
    const timestamp = Date.now();

    const record: FrameworkProjectRecord = {
      ...project,
      projectId,
      name,
      targetUrl: options.targetUrl,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const existing = await this.tryLoadRaw(projectId);
    if (existing) {
      record.createdAt = existing.createdAt ?? timestamp;
      record.updatedAt = timestamp;
      record.targetUrl = options.targetUrl ?? existing.targetUrl;
    }

    const storage = await this.getStorageBackend();
    if (storage.kind === "browser") {
      const key = `${this.storageKeyPrefix}${projectId}`;
      storage.localStorage.setItem(key, JSON.stringify(record));
      return record;
    }

    const fs = await readNodeFs();
    const nodePath = await readNodePath();
    if (!fs || !nodePath) {
      throw new Error(
        "FrameworkProjectStorage is unavailable because neither browser localStorage nor Node filesystem support is available.",
      );
    }

    const dir =
      this.baseDir ?? nodePath.resolve(process.cwd(), ".framework-projects");
    const projectDir = nodePath.join(dir, projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    const manifestPath = nodePath.join(projectDir, "project.json");
    fs.writeFileSync(manifestPath, JSON.stringify(record, null, 2), "utf8");
    return record;
  }

  async load(projectId: string): Promise<FrameworkProjectRecord> {
    const raw = await this.tryLoadRaw(projectId);
    if (!raw) {
      throw new Error(`Framework project "${projectId}" was not found.`);
    }
    return raw as FrameworkProjectRecord;
  }

  async list(): Promise<FrameworkProjectReference[]> {
    const storage = await this.getStorageBackend();
    if (storage.kind === "browser") {
      const prefix = this.storageKeyPrefix;
      return Array.from({ length: window.localStorage.length })
        .map((_, idx) => window.localStorage.key(idx))
        .filter((key): key is string => Boolean(key && key.startsWith(prefix)))
        .map((key) => {
          const raw = window.localStorage.getItem(key);
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw) as FrameworkProjectRecord;
            return {
              projectId: parsed.projectId,
              name: parsed.name,
              createdAt: parsed.createdAt,
              updatedAt: parsed.updatedAt,
            };
          } catch {
            return null;
          }
        })
        .filter((value): value is FrameworkProjectReference => Boolean(value));
    }

    const fs = await readNodeFs();
    const nodePath = await readNodePath();
    if (!fs || !nodePath) {
      return [];
    }

    const dir =
      this.baseDir ?? nodePath.resolve(process.cwd(), ".framework-projects");
    if (!fs.existsSync(dir)) {
      return [];
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const projects: FrameworkProjectReference[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const manifestPath = nodePath.join(dir, entry.name, "project.json");
      if (!fs.existsSync(manifestPath)) {
        continue;
      }
      try {
        const raw = fs.readFileSync(manifestPath, "utf8");
        const parsed = JSON.parse(raw) as FrameworkProjectRecord;
        projects.push({
          projectId: parsed.projectId,
          name: parsed.name,
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
        });
      } catch {
        // Ignore invalid project files.
      }
    }
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async delete(projectId: string): Promise<void> {
    const storage = await this.getStorageBackend();
    if (storage.kind === "browser") {
      storage.localStorage.removeItem(`${this.storageKeyPrefix}${projectId}`);
      return;
    }

    const fs = await readNodeFs();
    const nodePath = await readNodePath();
    if (!fs || !nodePath) {
      return;
    }

    const dir =
      this.baseDir ?? nodePath.resolve(process.cwd(), ".framework-projects");
    const projectDir = nodePath.join(dir, projectId);
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  }

  private async tryLoadRaw(
    projectId: string,
  ): Promise<FrameworkProjectRecord | null> {
    const storage = await this.getStorageBackend();
    if (storage.kind === "browser") {
      const raw = storage.localStorage.getItem(
        `${this.storageKeyPrefix}${projectId}`,
      );
      if (!raw) {
        return null;
      }
      try {
        return JSON.parse(raw) as FrameworkProjectRecord;
      } catch {
        return null;
      }
    }

    const fs = await readNodeFs();
    const nodePath = await readNodePath();
    if (!fs || !nodePath) {
      return null;
    }

    const dir =
      this.baseDir ?? nodePath.resolve(process.cwd(), ".framework-projects");
    const manifestPath = nodePath.join(dir, projectId, "project.json");
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(manifestPath, "utf8");
      return JSON.parse(raw) as FrameworkProjectRecord;
    } catch {
      return null;
    }
  }

  private async getStorageBackend(): Promise<
    { kind: "browser"; localStorage: Storage } | { kind: "node" }
  > {
    if (typeof window !== "undefined" && window.localStorage) {
      return { kind: "browser", localStorage: window.localStorage };
    }
    return { kind: "node" };
  }
}

export default FrameworkProjectStorage;
