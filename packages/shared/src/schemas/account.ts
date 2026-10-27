/**
 * Staff managing their own password (2026-10-27): change it while signed in, or reset a
 * forgotten one through a one-time link sent to the work email HR has on file.
 */
import { z } from 'zod';

const newPassword = z
  .string()
  .min(12, 'Password: at least 12 characters')
  .max(256, 'Password: at most 256 characters');

/** How long a reset link works. */
export const PASSWORD_RESET_MINUTES = 30;

/** Optional work email on a staff record (where reset links go). */
export const staffEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email: at most 254 characters')
  .email('Enter a valid email address');

export const forgotPasswordSchema = z.strictObject({
  /** A username or the work email on file. */
  identifier: z.string().trim().min(3, 'Enter your username or work email').max(254),
});

export const resetPasswordWithLinkSchema = z.strictObject({
  token: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{40,60}$/, 'This reset link is not valid'),
  password: newPassword,
});

export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1, 'Enter your current password').max(256),
    newPassword,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from the current one',
  });
