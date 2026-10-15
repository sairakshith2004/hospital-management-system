/**
 * npm run db:env:check
 *
 * Reports whether each database variable in .env is set and points at the right
 * role and database. Prints variable names and reasons only, never values.
 */
import { DB_ENV_VARS, checkVar } from './db-env.js';

let ok = true;
for (const name of DB_ENV_VARS) {
  const result = checkVar(name);
  if (result !== 'set') ok = false;
  console.log(`${name}: ${result}`);
}
if (!ok) {
  console.error('Some database variables are missing or invalid. See README, "Database roles".');
  process.exitCode = 1;
}
