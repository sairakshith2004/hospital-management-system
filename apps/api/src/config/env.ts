import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),
  // Signs the session cookie. Generated locally (64 hex characters); never logged.
  SESSION_SECRET: z
    .string()
    .min(32, 'must be at least 32 characters')
    .refine((v) => !v.startsWith('CHANGE_ME'), 'still has the .env.example placeholder'),
  // How many reverse-proxy hops to trust for the client IP. `true` (trust every hop)
  // would let any client fake its IP, so only false or 1–3 are accepted.
  TRUST_PROXY: z
    .enum(['false', '1', '2', '3'], 'must be false, 1, 2 or 3')
    .default('false')
    .transform((v) => (v === 'false' ? false : Number(v))),
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.join('\n')}`);
    this.name = 'EnvError';
  }
}

/** Parses configuration. Errors name the variable and rule only, never the value. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}
