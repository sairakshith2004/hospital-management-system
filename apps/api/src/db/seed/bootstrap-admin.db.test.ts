import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { connectTest, inRollback } from '../test-db.js';
import { BootstrapError, bootstrapAdmin } from './bootstrap-admin.js';

// Runs as hms_app, exactly like the command-line script. Synthetic values only.
let app!: pg.Client;
let hash!: string;
beforeAll(async () => {
  app = await connectTest('app');
  hash = await hashPassword('Synthetic-Admin-Passw0rd');
});
afterAll(async () => {
  await app?.end();
});

const tx = (work: () => Promise<void>) => () => inRollback(app, work);

describe('bootstrapAdmin', () => {
  it(
    'creates the department, employee, user and SA grant, and audits user.created',
    tx(async () => {
      const { userId } = await bootstrapAdmin(app, { username: 'zz_admin', passwordHash: hash });
      const { rows } = await app.query(
        `SELECT u.username::text AS username, u.status, e.employee_no, d.code AS department,
                array_agg(r.code) AS roles
         FROM users u JOIN employees e ON e.id = u.employee_id
         JOIN departments d ON d.id = e.department_id
         JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
         WHERE u.id = $1 GROUP BY u.id, e.employee_no, d.code`,
        [userId],
      );
      expect(rows[0]).toEqual({
        username: 'zz_admin',
        status: 'active',
        employee_no: 'SA-0001',
        department: 'ADMIN',
        roles: ['SA'],
      });
      const audit = await app.query(
        `SELECT actor_type, entity_id, reason, changes FROM audit_logs
         WHERE action = 'user.created' AND occurred_at = now()`,
      );
      expect(audit.rows).toEqual([
        {
          actor_type: 'system',
          entity_id: userId,
          reason: 'bootstrap',
          changes: { roles: ['SA'] },
        },
      ]);
      expect(JSON.stringify(audit.rows)).not.toContain(hash);
    }),
  );

  it.each(['active', 'disabled'])(
    'refuses a second run while an SA holder exists (%s), changing nothing',
    (status) =>
      tx(async () => {
        const { userId } = await bootstrapAdmin(app, { username: 'zz_admin', passwordHash: hash });
        await app.query('UPDATE users SET status = $2 WHERE id = $1', [userId, status]);
        const other = await hashPassword('Another-Synthetic-Passw0rd');
        await expect(
          bootstrapAdmin(app, { username: 'zz_admin', passwordHash: other }),
        ).rejects.toThrow(/administrator already exists/);
        await expect(
          bootstrapAdmin(app, { username: 'zz_admin2', passwordHash: other }),
        ).rejects.toBeInstanceOf(BootstrapError);
        const { rows } = await app.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
        expect(await verifyPassword(rows[0].password_hash, 'Synthetic-Admin-Passw0rd')).toBe(true);
        const count = await app.query(
          "SELECT count(*)::int AS n FROM users WHERE username LIKE 'zz_admin%'",
        );
        expect(count.rows[0].n).toBe(1);
      })(),
  );

  it.each(['Admin', 'ab', 'has space', '1admin'])('rejects the username %j', (username) =>
    tx(async () => {
      await expect(bootstrapAdmin(app, { username, passwordHash: hash })).rejects.toThrow(
        BootstrapError,
      );
    })(),
  );
});
