import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle-kit config for the team (center-server) database.
 *
 * - `db:generate`  → produce versioned SQL migrations into ./drizzle (git-managed)
 * - `db:migrate`   → apply pending migrations at server startup (see db-team/migrate.ts)
 * - `db:push`      → dev-only direct push (no migration files); NOT for production
 *
 * DB_URL points at the TiDB cluster (MySQL protocol):
 *   mysql://user:pass@host:4000/team_db
 * Leave DB_URL empty locally — the whole team feature degrades gracefully.
 */
export default defineConfig({
  dialect: 'mysql',
  schema: './src/server/db-team/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DB_URL || 'mysql://localhost:4000/autotest_team',
  },
  verbose: true,
  strict: true,
});
