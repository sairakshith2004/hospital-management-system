/**
 *   GET   /api/patients?q=      patient:read_demographics  search (MRN, phone or name)
 *   GET   /api/patients/:id     patient:read_demographics
 *   POST  /api/patients         patient:create             201 | 409 DUPLICATE_SUSPECTED
 *   PATCH /api/patients/:id     patient:update_demographics      409 STALE_VERSION
 */
import { createPatientSchema, patientSearchSchema, updatePatientSchema } from '@hospitalos/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { auditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requirePermission, requireUser } from '../../middleware/auth.js';
import { findPatient, searchPatients } from './patients.repo.js';
import { editPatient, registerPatient } from './patients.service.js';

const notFound = () => new AppError(404, 'NOT_FOUND', 'Patient not found');

/** A malformed ID can't name a patient: 404, the same as an unknown one. */
function patientId(value: unknown): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

export function patientRoutes(db: Database): Router {
  const router = Router();
  const canRead = requirePermission(db, 'patient:read_demographics');

  router.get('/', canRead, async (req, res) => {
    const { q } = patientSearchSchema.parse({ q: req.query.q ?? '' });
    res.json({ patients: await searchPatients(db, q) });
  });

  router.get('/:id', canRead, async (req, res) => {
    const patient = await findPatient(db, patientId(req.params.id));
    if (!patient) throw notFound();
    res.json({ patient });
  });

  router.post('/', requirePermission(db, 'patient:create'), async (req, res) => {
    const input = createPatientSchema.parse(req.body);
    const user = requireUser(res);
    const patient = await registerPatient(db, input, { userId: user.id }, auditContext(req, res));
    res.status(201).json({ patient });
  });

  router.patch('/:id', requirePermission(db, 'patient:update_demographics'), async (req, res) => {
    const id = patientId(req.params.id);
    const input = updatePatientSchema.parse(req.body);
    const user = requireUser(res);
    const patient = await editPatient(db, id, input, { userId: user.id }, auditContext(req, res));
    res.json({ patient });
  });

  return router;
}
