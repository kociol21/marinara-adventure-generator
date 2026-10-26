import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Where secret values live. The database only records secret names (secret_ref);
 * values stay in the secret store and are never sent to the browser.
 */
export interface SecretStore {
  readonly kind: "os-keyring" | "file" | "memory";
  get(name: string): string | null;
  set(name: string, value: string): void;
  delete(name: string): void;
}

/**
 * For Docker and other hosts without an OS credential store: one JSON file in the data folder,
 * readable by the app's user only. Anyone who can read the data folder can read the keys.
 */
export class FileSecretStore implements SecretStore {
  readonly kind = "file" as const;
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "secrets.json");
  }

  private read(): Record<string, string> {
    if (!existsSync(this.path)) return {};
    return JSON.parse(readFileSync(this.path, "utf8")) as Record<string, string>;
  }

  private write(values: Record<string, string>): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(values, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
  }

  get(name: string): string | null {
    return this.read()[name] ?? null;
  }

  set(name: string, value: string): void {
    this.write({ ...this.read(), [name]: value });
  }

  delete(name: string): void {
    const values = this.read();
    if (!(name in values)) return;
    delete values[name];
    this.write(values);
  }
}

/** For tests. */
export class MemorySecretStore implements SecretStore {
  readonly kind = "memory" as const;
  private readonly values = new Map<string, string>();

  get(name: string): string | null {
    return this.values.get(name) ?? null;
  }

  set(name: string, value: string): void {
    this.values.set(name, value);
  }

  delete(name: string): void {
    this.values.delete(name);
  }
}
