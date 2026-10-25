import { DEFAULT_SETTINGS, settingsSchema, type Settings, type UpdateSettingsInput } from "@adv/shared";
import { transaction, type Db } from "../db/database.ts";

/** Settings are stored one JSON value per key; unknown or invalid stored keys fall back to defaults. */
export function createSettingsRepo(db: Db) {
  const get = (): Settings => {
    const rows = db.prepare("SELECT key, value FROM setting").all() as Array<{ key: string; value: string }>;
    const stored: Record<string, unknown> = {};
    for (const { key, value } of rows) {
      try {
        stored[key] = JSON.parse(value);
      } catch {
        // Corrupt value: ignore and use the default.
      }
    }
    const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
      const candidate = settingsSchema.shape[key].safeParse(stored[key]);
      if (candidate.success) merged[key] = candidate.data;
    }
    return merged as Settings;
  };

  return {
    get,

    update(input: UpdateSettingsInput): Settings {
      const upsert = db.prepare(
        "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      );
      transaction(db, () => {
        for (const [key, value] of Object.entries(input)) {
          if (value !== undefined) upsert.run(key, JSON.stringify(value));
        }
      });
      return get();
    },
  };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
