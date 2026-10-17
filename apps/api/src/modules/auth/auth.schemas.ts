import { z } from 'zod';

/** Validation errors name the field and rule only; submitted values are never echoed. */
export const LoginBody = z.strictObject({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(256),
});

export type LoginBody = z.infer<typeof LoginBody>;
