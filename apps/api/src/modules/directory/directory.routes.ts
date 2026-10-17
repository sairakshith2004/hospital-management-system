/**
 *   GET /api/departments                  any signed-in user (reference data)
 *   GET /api/doctors?departmentId=<uuid>  schedule:read
 */
import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { listDepartments, listDoctors } from './directory.repo.js';

const DoctorQuery = z.strictObject({ departmentId: z.uuid().optional() });

export function departmentRoutes(db: Database): Router {
  const router = Router();
  router.get('/', requireAuth, async (_req, res) => {
    res.json({ departments: await listDepartments(db) });
  });
  return router;
}

export function doctorRoutes(db: Database): Router {
  const router = Router();
  router.get('/', requirePermission(db, 'schedule:read'), async (req, res) => {
    const { departmentId } = DoctorQuery.parse(req.query);
    res.json({ doctors: await listDoctors(db, departmentId) });
  });
  return router;
}
