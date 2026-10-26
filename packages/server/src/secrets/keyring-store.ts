import { Entry } from "@napi-rs/keyring";
import type { SecretStore } from "./secret-store.ts";

const SERVICE = "marinara-adventure-generator";

/**
 * Windows Credential Manager / macOS Keychain / Secret Service, via @napi-rs/keyring.
 * Kept in its own module and loaded on demand: containers have no credential store.
 */
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
