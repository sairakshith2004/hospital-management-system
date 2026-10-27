/**
 *   GET  /api/admin/staff                         user:manage | user_role:assign | employee:read
 *   POST /api/admin/staff                         user:create   (HR: employee, optional login; no roles yet)
 *   POST /api/admin/staff/:employeeId/login       user:create
 *   POST /api/admin/staff/:employeeId/email       user:create | user:manage (work email for reset links)
 *   POST /api/admin/users/:id/status              user:manage   (not self; ADM never on SA)
 *   POST /api/admin/users/:id/password            user:manage   (ends the user's sessions)
 *   POST /api/admin/users/:id/roles/grant|revoke  user_role:assign (not self; last SA kept)
 *   GET  /api/admin/roles                         user_role:assign | role:manage | user:manage
 *   POST /api/admin/departments                   department:manage
 *   POST /api/admin/doctors                       schedule:manage
 *   POST /api/admin/doctors/:id/fee               fee:manage
 *   GET  /api/doctors/:id/exceptions              schedule:read
 *   POST /api/doctors/:id/exceptions              schedule:manage
 *   POST /api/schedule-exceptions/:id/remove      schedule:manage
 *   GET  /api/admin/settings                      any settings permission (read)
 *   POST /api/admin/settings                      the key's own permission (C3)
 *   GET  /api/admin/audit?...                     audit:read (one audit_log.searched row per search;
 *                                                  SA sees patient MRNs, never names — note 10)
 */
import {
  SETTINGS,
  auditSearchSchema,
  createStaffSchema,
  staffEmailSchema,
  departmentSchema,
  doctorFeeSchema,
  doctorProfileSchema,
  resetPasswordSchema,
  roleChangeSchema,
  scheduleExceptionSchema,
  settingChangeSchema,
  userStatusSchema,
  USERNAME_RULE,
  type StaffAccount,
} from '@hospitalos/shared';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { auditContext, recordAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requireAnyPermission, requirePermission, requireUser } from '../../middleware/auth.js';
import {
  addScheduleException,
  changeFee,
  changeRole,
  changeSetting,
  createDepartment,
  createDoctorProfile,
  createLogin,
  createStaff,
  setStaffEmail,
  removeScheduleException,
  resetPassword,
  setUserStatus,
  type Actor,
} from './admin.service.js';

const uuid = (value: unknown, what = 'Record') => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError(404, 'NOT_FOUND', `${what} not found`);
  return parsed.data;
};
const actorOf = (res: Response): Actor => {
  const user = requireUser(res);
  return { userId: user.id, can: (p) => user.can(p) };
};

export function adminRoutes(db: Database): Router {
  const router = Router();

  router.get(
    '/admin/staff',
    requireAnyPermission(db, ['user:manage', 'user_role:assign', 'employee:read']),
    async (_req, res) => {
      const { rows } = await db.query<StaffAccount>(
        `SELECT e.id AS "employeeId", e.employee_no AS "employeeNo", e.full_name AS "fullName", e.designation,
              e.email::text AS email,
              e.employment_status AS "employmentStatus",
              json_build_object('id', d.id, 'name', d.name) AS department,
              CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object(
                'id', u.id, 'username', u.username,
                'status', CASE WHEN u.pending_approval THEN 'pending' ELSE u.status END,
                'locked', coalesce(u.locked_until > now(), false),
                'roles', (SELECT coalesce(json_agg(r.code ORDER BY r.code), '[]') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id))
              END AS user,
              dp.id AS "doctorProfileId"
       FROM employees e JOIN departments d ON d.id = e.department_id
       LEFT JOIN users u ON u.employee_id = e.id
       LEFT JOIN doctor_profiles dp ON dp.employee_id = e.id
       ORDER BY e.full_name`,
      );
      res.json({ staff: rows });
    },
  );
  router.post('/admin/staff', requirePermission(db, 'user:create'), async (req, res) => {
    const input = createStaffSchema.parse(req.body);
    res
      .status(201)
      .json({ employeeId: await createStaff(db, input, actorOf(res), auditContext(req, res)) });
  });
  router.post(
    '/admin/staff/:employeeId/login',
    requirePermission(db, 'user:create'),
    async (req, res) => {
      const input = z
        .strictObject({
          username: z
            .string()
            .trim()
            .regex(USERNAME_RULE, 'Username: 3–50 lowercase letters, digits, . _ or -'),
          password: z.string().min(12).max(256),
          reason: z.string().trim().min(1).max(200),
        })
        .parse(req.body);
      res.status(201).json({
        userId: await createLogin(
          db,
          uuid(req.params.employeeId, 'Employee'),
          input,
          actorOf(res),
          auditContext(req, res),
        ),
      });
    },
  );
  router.post(
    '/admin/staff/:employeeId/email',
    requireAnyPermission(db, ['user:create', 'user:manage']),
    async (req, res) => {
      const { email } = staffEmailSchema.parse(req.body);
      await setStaffEmail(
        db,
        uuid(req.params.employeeId, 'Employee'),
        email,
        actorOf(res),
        auditContext(req, res),
      );
      res.json({ ok: true });
    },
  );
  router.post('/admin/users/:id/status', requirePermission(db, 'user:manage'), async (req, res) => {
    const { status, reason } = userStatusSchema.parse(req.body);
    await setUserStatus(
      db,
      uuid(req.params.id, 'User'),
      status,
      reason,
      actorOf(res),
      auditContext(req, res),
    );
    res.json({ ok: true });
  });
  router.post(
    '/admin/users/:id/password',
    requirePermission(db, 'user:manage'),
    async (req, res) => {
      const { password, reason } = resetPasswordSchema.parse(req.body);
      await resetPassword(
        db,
        uuid(req.params.id, 'User'),
        password,
        reason,
        actorOf(res),
        auditContext(req, res),
      );
      res.json({ ok: true });
    },
  );
  router.post(
    '/admin/users/:id/roles/:verb',
    requirePermission(db, 'user_role:assign'),
    async (req, res) => {
      const verb = z.enum(['grant', 'revoke']).parse(req.params.verb);
      const { roleCode, reason } = roleChangeSchema.parse(req.body);
      await changeRole(
        db,
        uuid(req.params.id, 'User'),
        roleCode,
        verb === 'grant',
        reason,
        actorOf(res),
        auditContext(req, res),
      );
      res.json({ ok: true });
    },
  );
  router.get(
    '/admin/roles',
    requireAnyPermission(db, ['user_role:assign', 'role:manage', 'user:manage']),
    async (_req, res) => {
      const { rows } = await db.query(
        `SELECT r.code, r.name, (SELECT coalesce(json_agg(p.code ORDER BY p.code), '[]') FROM role_permissions rp
          JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id) AS permissions
       FROM roles r WHERE r.is_system ORDER BY r.code`,
      );
      res.json({ roles: rows });
    },
  );

  router.post(
    '/admin/departments',
    requirePermission(db, 'department:manage'),
    async (req, res) => {
      const input = departmentSchema.parse(req.body);
      res.status(201).json({
        departmentId: await createDepartment(db, input, actorOf(res), auditContext(req, res)),
      });
    },
  );
  router.post('/admin/doctors', requirePermission(db, 'schedule:manage'), async (req, res) => {
    const input = doctorProfileSchema.parse(req.body);
    res.status(201).json({
      doctorId: await createDoctorProfile(db, input, actorOf(res), auditContext(req, res)),
    });
  });
  router.post('/admin/doctors/:id/fee', requirePermission(db, 'fee:manage'), async (req, res) => {
    const { consultationFeePaise, reason } = doctorFeeSchema.parse(req.body);
    await changeFee(
      db,
      uuid(req.params.id, 'Doctor'),
      consultationFeePaise,
      reason,
      actorOf(res),
      auditContext(req, res),
    );
    res.json({ ok: true });
  });

  router.get(
    '/doctors/:id/exceptions',
    requirePermission(db, 'schedule:read'),
    async (req, res) => {
      const { rows } = await db.query(
        `SELECT id, kind, starts_at AS "startsAt", ends_at AS "endsAt", reason FROM schedule_exceptions
       WHERE doctor_id = $1 AND active AND ends_at > now() - interval '30 days' ORDER BY starts_at`,
        [uuid(req.params.id, 'Doctor')],
      );
      res.json({ exceptions: rows });
    },
  );
  router.post(
    '/doctors/:id/exceptions',
    requirePermission(db, 'schedule:manage'),
    async (req, res) => {
      const input = scheduleExceptionSchema.parse(req.body);
      res
        .status(201)
        .json(
          await addScheduleException(
            db,
            uuid(req.params.id, 'Doctor'),
            input,
            actorOf(res),
            auditContext(req, res),
          ),
        );
    },
  );
  router.post(
    '/schedule-exceptions/:id/remove',
    requirePermission(db, 'schedule:manage'),
    async (req, res) => {
      await removeScheduleException(
        db,
        uuid(req.params.id, 'Exception'),
        actorOf(res),
        auditContext(req, res),
      );
      res.json({ ok: true });
    },
  );

  const SETTINGS_PERMS = [
    'system_settings:manage',
    'security_settings:manage',
    'operational_settings:manage',
  ] as const;
  router.get(
    '/admin/settings',
    requireAnyPermission(db, [...SETTINGS_PERMS]),
    async (_req, res) => {
      const { rows } = await db.query(
        `SELECT ${Object.keys(SETTINGS).join(', ')}, timezone, currency FROM hospital_settings WHERE id = 1`,
      );
      res.json({ settings: rows[0] });
    },
  );
  router.post(
    '/admin/settings',
    requireAnyPermission(db, [...SETTINGS_PERMS]),
    async (req, res) => {
      const { key, value, reason } = settingChangeSchema.parse(req.body);
      await changeSetting(db, key, value, reason, actorOf(res), auditContext(req, res));
      res.json({ ok: true });
    },
  );

  router.get('/admin/audit', requirePermission(db, 'audit:read'), async (req, res) => {
    const f = auditSearchSchema.parse(req.query);
    const user = requireUser(res);
    // Note 10: this row is written directly here, once per search, never by a generic hook.
    await recordAudit(
      db,
      {
        actor: { type: 'user', userId: user.id },
        action: 'audit_log.searched',
        entityType: 'audit_log',
        changes: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v)])),
      },
      auditContext(req, res),
    );
    const { rows } = await db.query(
      `SELECT a.id::int AS id, a.occurred_at AS "occurredAt", a.actor_type AS "actorType",
              u.username AS actor, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId",
              p.mrn AS "patientMrn", a.reason, a.changes, a.request_id AS "requestId"
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id LEFT JOIN patients p ON p.id = a.patient_id
       WHERE ($1::text IS NULL OR a.action ILIKE $1 || '%')
         AND ($2::text IS NULL OR a.entity_type = $2)
         AND ($3::uuid IS NULL OR a.actor_user_id = $3)
         AND ($4::uuid IS NULL OR a.patient_id = $4)
         AND ($5::date IS NULL OR a.occurred_at >= ($5::date::timestamp AT TIME ZONE 'Asia/Kolkata'))
         AND ($6::date IS NULL OR a.occurred_at < (($6::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
         AND ($7::bigint IS NULL OR a.id < $7)
       ORDER BY a.id DESC LIMIT 100`,
      [
        f.action ?? null,
        f.entityType ?? null,
        f.actorUserId ?? null,
        f.patientId ?? null,
        f.from ?? null,
        f.to ?? null,
        f.before ?? null,
      ],
    );
    res.json({ rows });
  });

  return router;
}
