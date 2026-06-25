// 2026-06-23: Mobile apps DB — APK/IPA/HAP 包管理

import db from './index.js';

export interface MobileAppVersion {
  version: string;
  filename: string;
  file_size: number;
  uploaded_at: string;
  changelog?: string;
}

export interface MobileAppRow {
  id: number;
  user_id: number;
  name: string;
  platform: 'android' | 'ios' | 'harmony';
  package_name: string | null;
  versions: string; // JSON string of MobileAppVersion[]
  latest_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface MobileAppListFilter {
  name?: string;
  platform?: string;
  packageName?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CreateMobileAppInput {
  name: string;
  platform: 'android' | 'ios' | 'harmony';
  package_name?: string;
}

export interface UpdateMobileAppInput {
  name?: string;
  platform?: 'android' | 'ios' | 'harmony';
  package_name?: string;
}

// ── List ──

export function findMobileAppsByUser(
  userId: number,
  filters?: MobileAppListFilter,
): MobileAppRow[] {
  const conditions = ['user_id = ?'];
  const params: unknown[] = [userId];

  if (filters?.name) {
    conditions.push('name LIKE ?');
    params.push(`%${filters.name}%`);
  }
  if (filters?.platform) {
    conditions.push('platform = ?');
    params.push(filters.platform);
  }
  if (filters?.packageName) {
    conditions.push('package_name LIKE ?');
    params.push(`%${filters.packageName}%`);
  }
  if (filters?.dateFrom) {
    conditions.push('created_at >= ?');
    params.push(filters.dateFrom);
  }
  if (filters?.dateTo) {
    conditions.push('created_at <= ?');
    params.push(filters.dateTo + ' 23:59:59');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(
    `SELECT * FROM mobile_apps ${where} ORDER BY updated_at DESC`,
  ).all(...params) as MobileAppRow[];
}

// ── Find by ID ──

export function findMobileAppById(id: number, userId: number): MobileAppRow | undefined {
  return db.prepare(
    'SELECT * FROM mobile_apps WHERE id = ? AND user_id = ?',
  ).get(id, userId) as MobileAppRow | undefined;
}

export function findMobileAppByName(userId: number, name: string): MobileAppRow | undefined {
  return db.prepare(
    'SELECT * FROM mobile_apps WHERE user_id = ? AND name = ?',
  ).get(userId, name) as MobileAppRow | undefined;
}

// ── Create ──

export function createMobileApp(userId: number, data: CreateMobileAppInput): number {
  const result = db.prepare(
    `INSERT INTO mobile_apps (user_id, name, platform, package_name)
     VALUES (?, ?, ?, ?)`,
  ).run(userId, data.name, data.platform, data.package_name ?? null);
  return result.lastInsertRowid as number;
}

// ── Update ──

export function updateMobileApp(id: number, userId: number, data: UpdateMobileAppInput): boolean {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); params.push(data.name); }
  if (data.platform !== undefined) { fields.push('platform = ?'); params.push(data.platform); }
  if (data.package_name !== undefined) { fields.push('package_name = ?'); params.push(data.package_name); }

  if (fields.length === 0) return false;
  fields.push("updated_at = datetime('now', '+8 hours')");
  params.push(id, userId);

  const result = db.prepare(
    `UPDATE mobile_apps SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
  ).run(...params);
  return result.changes > 0;
}

// ── Delete ──

export function deleteMobileApp(id: number, userId: number): boolean {
  const result = db.prepare(
    'DELETE FROM mobile_apps WHERE id = ? AND user_id = ?',
  ).run(id, userId);
  return result.changes > 0;
}

// ── Add version ──

export function addMobileAppVersion(id: number, userId: number, versionInfo: MobileAppVersion): boolean {
  const row = findMobileAppById(id, userId);
  if (!row) return false;

  const versions: MobileAppVersion[] = JSON.parse(row.versions);
  // Replace if same version exists
  const idx = versions.findIndex(v => v.version === versionInfo.version);
  if (idx >= 0) {
    versions[idx] = versionInfo;
  } else {
    versions.push(versionInfo);
  }

  const latest = versions.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))[0]?.version ?? null;

  const result = db.prepare(
    `UPDATE mobile_apps SET versions = ?, latest_version = ?, updated_at = datetime('now', '+8 hours')
     WHERE id = ? AND user_id = ?`,
  ).run(JSON.stringify(versions), latest, id, userId);
  return result.changes > 0;
}

// ── Remove version ──

export function removeMobileAppVersion(id: number, userId: number, version: string): { ok: boolean; filename?: string } {
  const row = findMobileAppById(id, userId);
  if (!row) return { ok: false };

  const versions: MobileAppVersion[] = JSON.parse(row.versions);
  const target = versions.find(v => v.version === version);
  if (!target) return { ok: false };

  const remaining = versions.filter(v => v.version !== version);
  const latest = remaining.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))[0]?.version ?? null;

  db.prepare(
    `UPDATE mobile_apps SET versions = ?, latest_version = ?, updated_at = datetime('now', '+8 hours')
     WHERE id = ? AND user_id = ?`,
  ).run(JSON.stringify(remaining), latest, id, userId);

  return { ok: true, filename: target.filename };
}

// ── Get version info ──

export function getMobileAppVersion(id: number, userId: number, version: string): MobileAppVersion | undefined {
  const row = findMobileAppById(id, userId);
  if (!row) return undefined;
  const versions: MobileAppVersion[] = JSON.parse(row.versions);
  return versions.find(v => v.version === version);
}
