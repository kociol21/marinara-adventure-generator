import { z } from "zod";

/**
 * Portrait settings live on the project, outside the requirements: changing the style re-renders
 * only the portraits, not the whole adventure.
 */
export const portraitStyleSchema = z.enum(["auto", "realistic", "painted", "anime", "comic", "pulp"]);
export type PortraitStyle = z.infer<typeof portraitStyleSchema>;

export const PORTRAIT_STYLES: Record<PortraitStyle, { label: string; prompt: string }> = {
  auto: { label: "From the requirements", prompt: "" },
  realistic: { label: "Realistic", prompt: "photorealistic portrait photograph, natural skin texture, soft cinematic lighting, shallow depth of field" },
  painted: { label: "Painted", prompt: "painterly digital portrait, visible brush strokes, rich colour and light" },
  anime: { label: "Anime", prompt: "anime illustration, clean line art, cel shading, expressive eyes" },
  comic: { label: "Comic", prompt: "graphic novel illustration, bold inks, flat colour, strong shadows" },
  pulp: { label: "Vintage pulp", prompt: "vintage pulp magazine illustration, gouache, halftone grain, dramatic lighting" },
};

export const portraitSettingsSchema = z.object({
  /** Generate portraits when an image model is assigned. */
  enabled: z.boolean().default(true),
  style: portraitStyleSchema.default("auto"),
  /** Extra direction added to every portrait prompt, e.g. "muted colours, rain". */
  notes: z.string().trim().max(500).default(""),
});
export type PortraitSettings = z.infer<typeof portraitSettingsSchema>;
