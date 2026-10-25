import { z } from "zod";

/** Field rules without defaults, so partial updates never fill in (and overwrite) untouched keys. */
const settingsFields = {
  /** "Show spoilers" is an explicit opt-in; it never defaults on. */
  showSpoilers: z.boolean(),
  /** Max automatic fix attempts per pipeline stage before asking the user. */
  maxAutoFixAttempts: z.number().int().min(0).max(5),
  /** Marinara base URL used by "Push to Marinara". */
  marinaraBaseUrl: z.string().url().or(z.literal("")),
};

export const settingsSchema = z.object(settingsFields);
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  showSpoilers: false,
  maxAutoFixAttempts: 2,
  marinaraBaseUrl: "",
};

export const updateSettingsSchema = z.object(settingsFields).partial().strict();
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
