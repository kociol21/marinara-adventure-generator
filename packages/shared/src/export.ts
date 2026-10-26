/** Contents of manifest.json in the export bundle; also what the app shows before download. */
export interface ExportManifest {
  generator: string;
  generatorVersion: string;
  format: "marinara-native-v1";
  title: string;
  createdAt: string;
  requirementsApprovedAt: string | null;
  files: Array<{ path: string; kind: "character" | "persona" | "lorebook" | "guide"; sha256: string }>;
  counts: { characters: number; personas: number; lorebooks: number; lorebookEntries: number };
  /** Spec §8 and criterion 7: configured settings are not vectors built in Marinara, nor verified in play. */
  vectors: Array<{ lorebook: string; status: "configured-not-built" | "off"; configured: boolean; built: false; verifiedInGame: false }>;
  portraits: Array<{ name: string; included: boolean; check: "match" | "mismatch" | "unchecked" | null }>;
  audit: { ran: boolean; openFindings: number; major: number; fixRounds: number; maxFixRounds: number };
  secretPlot: "not-included";
  /** What a file export cannot do; Push to Marinara covers these. */
  notIncluded: string[];
  validation: { errors: number; warnings: number };
}

/** GET /projects/:id/export/summary */
export interface ExportSummary {
  manifest: ExportManifest;
  /** Validation warnings and notes (spoiler-free). */
  notes: string[];
}
