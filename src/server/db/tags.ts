import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import db from './index.js';

export const tagRoutes = Router();
tagRoutes.use(authMiddleware);

interface TagInfo {
  name: string;
  color: string;
  count: number;
  sources: { apis: number; scenarios: number; scenario_sets: number };
}

// GET /api/tags - 获取用户所有已使用的标签（含引用计数）
tagRoutes.get('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;

  try {
    const tagMap = new Map<string, { color: string; apis: number; scenarios: number; scenario_sets: number }>();

    // 首先从独立的 tags 表获取预定义标签
    const userTags = db.prepare('SELECT name, color FROM user_tags WHERE user_id = ?').all(userId) as { name: string; color: string }[];
    for (const row of userTags) {
      if (!tagMap.has(row.name)) {
        tagMap.set(row.name, { color: row.color || '', apis: 0, scenarios: 0, scenario_sets: 0 });
      }
    }

    const countInField = (tagsStr: string, tag: string): number => {
      if (!tagsStr) return 0;
      return tagsStr.split(',').map(t => t.trim()).filter(t => t === tag).length;
    };

    // API 标签计数
    const apiRows = db.prepare('SELECT id, tags FROM apis WHERE user_id = ?').all(userId) as { id: number; tags: string }[];
    for (const row of apiRows) {
      if (row.tags) {
        row.tags.split(',').forEach((t) => {
          const trimmed = t.trim();
          if (trimmed) {
            const existing = tagMap.get(trimmed) || { color: '', apis: 0, scenarios: 0, scenario_sets: 0 };
            existing.apis += countInField(row.tags, trimmed);
            tagMap.set(trimmed, existing);
          }
        });
      }
    }

    // 场景标签计数
    const scenarioRows = db.prepare('SELECT id, tags FROM scenarios WHERE user_id = ?').all(userId) as { id: number; tags: string }[];
    for (const row of scenarioRows) {
      if (row.tags) {
        row.tags.split(',').forEach((t) => {
          const trimmed = t.trim();
          if (trimmed) {
            const existing = tagMap.get(trimmed) || { color: '', apis: 0, scenarios: 0, scenario_sets: 0 };
            existing.scenarios += countInField(row.tags, trimmed);
            tagMap.set(trimmed, existing);
          }
        });
      }
    }

    // 场景集标签计数
    const setRows = db.prepare('SELECT id, tags FROM scenario_sets WHERE user_id = ?').all(userId) as { id: number; tags: string }[];
    for (const row of setRows) {
      if (row.tags) {
        row.tags.split(',').forEach((t) => {
          const trimmed = t.trim();
          if (trimmed) {
            const existing = tagMap.get(trimmed) || { color: '', apis: 0, scenarios: 0, scenario_sets: 0 };
            existing.scenario_sets += countInField(row.tags, trimmed);
            tagMap.set(trimmed, existing);
          }
        });
      }
    }

    const result: TagInfo[] = [];
    tagMap.forEach((sources, name) => {
      result.push({ name, color: sources.color, count: sources.apis + sources.scenarios + sources.scenario_sets, sources });
    });
    result.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ code: 200, message: 'ok', data: result });
  } catch (err) {
    console.error('Failed to fetch tags:', err);
    res.status(500).json({ code: 500, message: 'Failed to fetch tags' });
  }
});

// DELETE /api/tags/:name - 删除标签并清除所有引用
tagRoutes.delete('/:name', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const tagName = decodeURIComponent(req.params.name).trim();

  if (!tagName) {
    res.status(400).json({ code: 400, message: 'Tag name is required' });
    return;
  }

  try {
    // 从 user_tags 表删除
    db.prepare('DELETE FROM user_tags WHERE user_id = ? AND name = ?').run(userId, tagName);

    // 清除 apis 中的引用
    const apis = db.prepare('SELECT id, tags FROM apis WHERE user_id = ?').all(userId) as { id: number; tags: string }[];
    for (const api of apis) {
      if (api.tags && api.tags.split(',').map(t => t.trim()).includes(tagName)) {
        const newTags = api.tags.split(',').map(t => t.trim()).filter(t => t !== tagName).join(',');
        db.prepare('UPDATE apis SET tags = ? WHERE id = ?').run(newTags, api.id);
      }
    }

    // 清除 scenarios 中的引用
    const scenarios = db.prepare('SELECT id, tags FROM scenarios WHERE user_id = ?').all(userId) as { id: number; tags: string }[];
    for (const s of scenarios) {
      if (s.tags && s.tags.split(',').map(t => t.trim()).includes(tagName)) {
        const newTags = s.tags.split(',').map(t => t.trim()).filter(t => t !== tagName).join(',');
        db.prepare('UPDATE scenarios SET tags = ? WHERE id = ?').run(newTags, s.id);
      }
    }

    // 清除 scenario_sets 中的引用
    const sets = db.prepare('SELECT id, tags FROM scenario_sets WHERE user_id = ?').all(userId) as { id: number; tags: string }[];
    for (const s of sets) {
      if (s.tags && s.tags.split(',').map(t => t.trim()).includes(tagName)) {
        const newTags = s.tags.split(',').map(t => t.trim()).filter(t => t !== tagName).join(',');
        db.prepare('UPDATE scenario_sets SET tags = ? WHERE id = ?').run(newTags, s.id);
      }
    }

    res.json({ code: 200, message: `Tag "${tagName}" deleted successfully` });
  } catch (err) {
    console.error('Failed to delete tag:', err);
    res.status(500).json({ code: 500, message: 'Failed to delete tag' });
  }
});

// POST /api/tags - 创建/确认标签
tagRoutes.post('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { name, color } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ code: 400, message: 'Tag name is required' });
    return;
  }

  const tagName = name.trim();
  const tagColor = (typeof color === 'string' ? color.trim() : '') || '';

  try {
    // 检查是否已存在
    const existing = db.prepare('SELECT name, color FROM user_tags WHERE user_id = ? AND name = ?').get(userId, tagName) as { name: string; color: string } | undefined;
    if (existing) {
      // 如果传了颜色且与现有不同，更新颜色
      if (tagColor && tagColor !== existing.color) {
        db.prepare('UPDATE user_tags SET color = ? WHERE user_id = ? AND name = ?').run(tagColor, userId, tagName);
      }
      res.json({ code: 200, message: 'Tag already exists', data: { name: tagName, color: tagColor || existing.color, exists: true } });
    } else {
      // 插入到 user_tags 表
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      db.prepare('INSERT INTO user_tags (user_id, name, color, created_at) VALUES (?, ?, ?, ?)').run(userId, tagName, tagColor, now);
      res.json({ code: 200, message: 'Tag created', data: { name: tagName, color: tagColor, exists: false } });
    }
  } catch (err) {
    console.error('Failed to create tag:', err);
    res.status(500).json({ code: 500, message: 'Failed to create tag' });
  }
});

// PUT /api/tags/:name/rename - 重命名标签（可选更新颜色）
tagRoutes.put('/:name/rename', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const oldName = decodeURIComponent(req.params.name).trim();
  const { newName, color } = req.body;

  if (!oldName || !newName || typeof newName !== 'string' || !newName.trim()) {
    res.status(400).json({ code: 400, message: 'Invalid tag name' });
    return;
  }

  const tagName = newName.trim();

  try {
    // 检查新名称是否已存在
    const existing = db.prepare('SELECT name FROM user_tags WHERE user_id = ? AND name = ? AND name != ?').get(userId, tagName, oldName);
    if (existing) {
      res.status(400).json({ code: 400, message: 'Tag name already exists' });
      return;
    }

    // 更新 user_tags 表（名称 + 可选颜色）
    if (typeof color === 'string') {
      db.prepare('UPDATE user_tags SET name = ?, color = ? WHERE user_id = ? AND name = ?').run(tagName, color.trim(), userId, oldName);
    } else {
      db.prepare('UPDATE user_tags SET name = ? WHERE user_id = ? AND name = ?').run(tagName, userId, oldName);
    }

    // 更新 apis 中的标签
    const apis = db.prepare('SELECT id, tags FROM apis WHERE user_id = ?').all(userId) as { id: number; tags: string }[];
    for (const api of apis) {
      if (api.tags && api.tags.split(',').map(t => t.trim()).includes(oldName)) {
        const newTags = api.tags.split(',').map(t => t.trim()).map(t => t === oldName ? tagName : t).join(',');
        db.prepare('UPDATE apis SET tags = ? WHERE id = ?').run(newTags, api.id);
      }
    }

    // 更新 scenarios 中的标签
    const scenarios = db.prepare('SELECT id, tags FROM scenarios WHERE user_id = ?').all(userId) as { id: number; tags: string }[];
    for (const s of scenarios) {
      if (s.tags && s.tags.split(',').map(t => t.trim()).includes(oldName)) {
        const newTags = s.tags.split(',').map(t => t.trim()).map(t => t === oldName ? tagName : t).join(',');
        db.prepare('UPDATE scenarios SET tags = ? WHERE id = ?').run(newTags, s.id);
      }
    }

    // 更新 scenario_sets 中的标签
    const sets = db.prepare('SELECT id, tags FROM scenario_sets WHERE user_id = ?').all(userId) as { id: number; tags: string }[];
    for (const s of sets) {
      if (s.tags && s.tags.split(',').map(t => t.trim()).includes(oldName)) {
        const newTags = s.tags.split(',').map(t => t.trim()).map(t => t === oldName ? tagName : t).join(',');
        db.prepare('UPDATE scenario_sets SET tags = ? WHERE id = ?').run(newTags, s.id);
      }
    }

    res.json({ code: 200, message: `Tag renamed to "${tagName}"` });
  } catch (err) {
    console.error('Failed to rename tag:', err);
    res.status(500).json({ code: 500, message: 'Failed to rename tag' });
  }
});

// PUT /api/tags/:name/color - 更新标签颜色
tagRoutes.put('/:name/color', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const tagName = decodeURIComponent(req.params.name).trim();
  const { color } = req.body;

  if (!tagName) {
    res.status(400).json({ code: 400, message: 'Tag name is required' });
    return;
  }

  if (typeof color !== 'string') {
    res.status(400).json({ code: 400, message: 'Color is required' });
    return;
  }

  try {
    const existing = db.prepare('SELECT name FROM user_tags WHERE user_id = ? AND name = ?').get(userId, tagName);
    if (!existing) {
      res.status(404).json({ code: 404, message: 'Tag not found' });
      return;
    }

    db.prepare('UPDATE user_tags SET color = ? WHERE user_id = ? AND name = ?').run(color.trim(), userId, tagName);
    res.json({ code: 200, message: 'Tag color updated' });
  } catch (err) {
    console.error('Failed to update tag color:', err);
    res.status(500).json({ code: 500, message: 'Failed to update tag color' });
  }
});