import { Entry } from "@napi-rs/keyring";

/**
 * Where secret values live. The database only records secret names (secret_ref);
 * values stay in the OS credential store and are never sent to the browser.
 */
export interface SecretStore {
  readonly kind: "os-keyring" | "memory";
  get(name: string): string | null;
  set(name: string, value: string): void;
  delete(name: string): void;
}

const SERVICE = "marinara-adventure-generator";

/** Windows Credential Manager / macOS Keychain / Secret Service, via @napi-rs/keyring. */
export class KeyringSecretStore implements SecretStore {
  readonly kind = "os-keyring" as const;

  get(name: string): string | null {
    return new Entry(SERVICE, name).getPassword() ?? null;
  }

  set(name: string, value: string): void {
    new Entry(SERVICE, name).setPassword(value);
  }

  delete(name: string): void {
    try {
      new Entry(SERVICE, name).deletePassword();
    } catch {
      // Already absent.
    }
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
