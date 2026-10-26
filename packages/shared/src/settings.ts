import { z } from "zod";

/** Field rules without defaults, so partial updates never fill in (and overwrite) untouched keys. */
const settingsFields = {
  /** "Show spoilers" is an explicit opt-in; it never defaults on. */
  showSpoilers: z.boolean(),
  /** Max automatic fix attempts per pipeline stage before asking the user. */
  maxAutoFixAttempts: z.number().int().min(0).max(5),
  /** Decision-model judge: a part passes when every answer is above this (0 to 1). */
  judgeThreshold: z.number().min(0.5).max(0.95),
  /** Fix rounds the judge may ask for in total; the other audit findings keep maxAutoFixAttempts. */
  judgeMaxRounds: z.number().int().min(0).max(6),
  /** Marinara base URL used by "Push to Marinara". */
  marinaraBaseUrl: z.string().url().or(z.literal("")),
  /** Ask GitHub for the latest release (twice a day at most) and show a notice when there is one. */
  checkForUpdates: z.boolean(),
};

export const settingsSchema = z.object(settingsFields);
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  showSpoilers: false,
  maxAutoFixAttempts: 2,
  judgeThreshold: 0.7,
  judgeMaxRounds: 4,
  marinaraBaseUrl: "",
  checkForUpdates: true,
};

export const updateSettingsSchema = z.object(settingsFields).partial().strict();
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
