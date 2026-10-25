import { z } from "zod";

/** Secret names are references (e.g. "connection:<id>:api-key"); values never leave the server. */
export const secretNameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9:._-]*$/, "Use lowercase letters, digits and : . _ -");

export const putSecretSchema = z.object({
  value: z.string().min(1).max(20_000),
});

export interface SecretInfo {
  name: string;
  updatedAt: string;
}
