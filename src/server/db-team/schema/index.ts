/**
 * Team schema barrel. Business tables (per test-type, with team_id/project_id
 * + optimistic-lock version columns) are added here in Phase 2 — see
 * docs/TEAM_COLLABORATION_PLAN.md.
 */

export * from './org.js';
export * from './versions.js';
