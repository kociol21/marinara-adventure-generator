import { z } from "zod";

export const projectStatusSchema = z.enum(["draft", "interview", "approved", "generating", "ready", "exported"]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const projectSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: projectStatusSchema,
  /** Spoiler-free teaser; the only story text the library ever shows. */
  teaser: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(200),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    teaser: z.string().max(2000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
