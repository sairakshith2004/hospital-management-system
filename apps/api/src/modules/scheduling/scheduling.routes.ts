/**
 *   GET   /api/doctors/:id/availability?date=     schedule:read      slots, no patient data
 *   GET   /api/doctors/:id/schedules              schedule:read
 *   POST  /api/doctors/:id/schedules              schedule:manage    409 SCHEDULE_OVERLAP
 *   PATCH /api/doctors/:id/schedules/:scheduleId  schedule:manage    { active: false } only
 *
 *   GET   /api/appointments?date=&doctorId=&status=   queue:read (scoped, see below)
 *   GET   /api/appointments/:id                       queue:read (scoped)
 *   POST  /api/appointments                           appointment:book
 *   POST  /api/appointments/:id/cancel                appointment:cancel
 *   POST  /api/appointments/:id/reschedule            appointment:reschedule
 *   POST  /api/appointments/:id/check-in              appointment:check_in
 *   POST  /api/appointments/:id/no-show               appointment:mark_no_show
 *   GET   /api/queue?date=&doctorId=                  queue:read (scoped)
 *
 * Scope (docs/permissions.md note 12): with appointment:read_all, every doctor; otherwise
 * only the caller's own doctor profile, and 403 without one. Another doctor's record or
 * queue answers 404, exactly like an unknown ID, and writes an access.denied audit row.
 */
import {
  appointmentListQuerySchema,
  availabilityQuerySchema,
  cancelAppointmentSchema,
  createAppointmentSchema,
  createScheduleSchema,
  hospitalToday,
  queueQuerySchema,
  rescheduleAppointmentSchema,
  updateScheduleSchema,
} from '@hospitalos/shared';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { auditContext, recordAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requirePermission, requireUser } from '../../middleware/auth.js';
import {
  doctorExists,
  doctorIdOfUser,
  findAppointment,
  listAppointments,
  listQueue,
  listSchedules,
  listSlots,
} from './scheduling.repo.js';
import {
  appointmentNotFound,
  cancelAppointment,
  checkIn,
  createAppointment,
  createSchedule,
  markNoShow,
  removeSchedule,
  rescheduleAppointment,
} from './scheduling.service.js';

/** A malformed ID can't name a record: 404, the same as an unknown one. */
function idParam(value: unknown, notFound: () => AppError): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

const doctorNotFound = () => new AppError(404, 'NOT_FOUND', 'Doctor not found');

type Scope = { all: true } | { all: false; doctorId: string };

/** Which doctors' appointments the caller may see. Refusals are audited, like every 403. */
async function resolveScope(db: Database, req: Request, res: Response): Promise<Scope> {
  const user = requireUser(res);
  if (user.can('appointment:read_all')) return { all: true };
  const doctorId = await doctorIdOfUser(db, user.id);
  if (!doctorId) {
    const route = (req.route as { path?: unknown } | undefined)?.path;
    await recordAudit(
      db,
      {
        actor: { type: 'user', userId: user.id },
        action: 'access.denied',
        entityType: 'route',
        entityId: `${req.method} ${req.baseUrl}${typeof route === 'string' ? route : ''}`,
        reason: 'no_doctor_profile',
      },
      auditContext(req, res),
    );
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to do this');
  }
  return { all: false, doctorId };
}

/** Out-of-scope access: audited, then answered exactly like a missing record. */
async function denyOutOfScope(
  db: Database,
  req: Request,
  res: Response,
  entityType: string,
  entityId: string,
): Promise<never> {
  await recordAudit(
    db,
    {
      actor: { type: 'user', userId: requireUser(res).id },
      action: 'access.denied',
      entityType,
      entityId,
      reason: 'other_doctor',
    },
    auditContext(req, res),
  );
  throw entityType === 'appointment' ? appointmentNotFound() : doctorNotFound();
}

/** The doctor filter for a list: an explicit doctorId must be inside the caller's scope. */
async function doctorFilter(
  db: Database,
  req: Request,
  res: Response,
  requested: string | undefined,
): Promise<string | null> {
  const scope = await resolveScope(db, req, res);
  if (scope.all) return requested ?? null;
  if (requested && requested !== scope.doctorId) {
    return denyOutOfScope(db, req, res, 'doctor', requested);
  }
  return scope.doctorId;
}

export function schedulingDoctorRoutes(db: Database): Router {
  const router = Router();
  const canRead = requirePermission(db, 'schedule:read');
  const canManage = requirePermission(db, 'schedule:manage');

  async function doctorParam(value: unknown): Promise<string> {
    const id = idParam(value, doctorNotFound);
    if (!(await doctorExists(db, id))) throw doctorNotFound();
    return id;
  }

  router.get('/:id/availability', canRead, async (req, res) => {
    const id = await doctorParam(req.params.id);
    const { date } = availabilityQuerySchema.parse(req.query);
    res.json({ date, slots: await listSlots(db, id, date) });
  });

  router.get('/:id/schedules', canRead, async (req, res) => {
    const id = await doctorParam(req.params.id);
    res.json({ schedules: await listSchedules(db, id) });
  });

  router.post('/:id/schedules', canManage, async (req, res) => {
    const id = await doctorParam(req.params.id);
    const input = createScheduleSchema.parse(req.body);
    const user = requireUser(res);
    const schedule = await createSchedule(
      db,
      id,
      { ...input, validTo: input.validTo ?? null },
      { userId: user.id },
      auditContext(req, res),
    );
    res.status(201).json({ schedule });
  });

  router.patch('/:id/schedules/:scheduleId', canManage, async (req, res) => {
    const id = await doctorParam(req.params.id);
    const scheduleId = idParam(
      req.params.scheduleId,
      () => new AppError(404, 'NOT_FOUND', 'Schedule not found'),
    );
    updateScheduleSchema.parse(req.body);
    const user = requireUser(res);
    const schedule = await removeSchedule(
      db,
      id,
      scheduleId,
      { userId: user.id },
      auditContext(req, res),
    );
    res.json({ schedule });
  });

  return router;
}

export function appointmentRoutes(db: Database): Router {
  const router = Router();
  const canRead = requirePermission(db, 'queue:read');
  const appointmentId = (value: unknown) => idParam(value, appointmentNotFound);

  router.get('/', canRead, async (req, res) => {
    const query = appointmentListQuerySchema.parse(req.query);
    const doctorId = await doctorFilter(db, req, res, query.doctorId);
    res.json({
      appointments: await listAppointments(db, {
        date: query.date,
        doctorId,
        ...(query.status ? { status: query.status } : {}),
      }),
    });
  });

  router.get('/:id', canRead, async (req, res) => {
    const id = appointmentId(req.params.id);
    const scope = await resolveScope(db, req, res);
    const appointment = await findAppointment(db, id);
    if (!appointment) throw appointmentNotFound();
    if (!scope.all && appointment.doctor.id !== scope.doctorId) {
      await denyOutOfScope(db, req, res, 'appointment', id);
    }
    res.json({ appointment });
  });

  router.post('/', requirePermission(db, 'appointment:book'), async (req, res) => {
    const input = createAppointmentSchema.parse(req.body);
    const user = requireUser(res);
    const appointment = await createAppointment(
      db,
      input,
      { userId: user.id },
      auditContext(req, res),
    );
    res.status(201).json({ appointment });
  });

  router.post('/:id/cancel', requirePermission(db, 'appointment:cancel'), async (req, res) => {
    const id = appointmentId(req.params.id);
    const { reason } = cancelAppointmentSchema.parse(req.body);
    const user = requireUser(res);
    const appointment = await cancelAppointment(
      db,
      id,
      reason,
      { userId: user.id },
      auditContext(req, res),
    );
    res.json({ appointment });
  });

  router.post(
    '/:id/reschedule',
    requirePermission(db, 'appointment:reschedule'),
    async (req, res) => {
      const id = appointmentId(req.params.id);
      const input = rescheduleAppointmentSchema.parse(req.body);
      const user = requireUser(res);
      const appointment = await rescheduleAppointment(
        db,
        id,
        input,
        { userId: user.id },
        auditContext(req, res),
      );
      res.status(201).json({ appointment });
    },
  );

  router.post('/:id/check-in', requirePermission(db, 'appointment:check_in'), async (req, res) => {
    const id = appointmentId(req.params.id);
    const user = requireUser(res);
    const appointment = await checkIn(db, id, { userId: user.id }, auditContext(req, res));
    res.json({ appointment });
  });

  router.post(
    '/:id/no-show',
    requirePermission(db, 'appointment:mark_no_show'),
    async (req, res) => {
      const id = appointmentId(req.params.id);
      const user = requireUser(res);
      const appointment = await markNoShow(db, id, { userId: user.id }, auditContext(req, res));
      res.json({ appointment });
    },
  );

  return router;
}

export function queueRoutes(db: Database): Router {
  const router = Router();
  router.get('/', requirePermission(db, 'queue:read'), async (req, res) => {
    const query = queueQuerySchema.parse(req.query);
    const doctorId = await doctorFilter(db, req, res, query.doctorId);
    const date = query.date ?? hospitalToday();
    res.json({ date, queue: await listQueue(db, { date, doctorId }) });
  });
  return router;
}
