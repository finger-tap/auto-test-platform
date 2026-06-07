import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../utils/api';
import notification from '../../utils/notification';
import './MidsceneConfig.css';

// Midscene v1.8.7 接受的 MIDSCENE_MODEL_FAMILY 取值。
// 来自执行器运行时报错:Invalid MIDSCENE_MODEL_FAMILY value.
// 改 family 不需要重启服务,保存后下一次执行即生效。
const MIDSCENE_MODEL_FAMILIES = [
  'doubao-vision',
  'doubao-seed',
  'gemini',
  'qwen2.5-vl',
  'qwen3-vl',
  'qwen3.5',
  'qwen3.6',
  'vlm-ui-tars',
  'vlm-ui-tars-doubao',
  'vlm-ui-tars-doubao-1.5',
  'glm-v',
  'auto-glm',
  'auto-glm-multilingual',
  'gpt-5',
] as const;

// One row shape — used for the default / insight / planning intent sections.
interface ModelSection {
  model_name: string;
  model_api_key: string;
  model_base_url: string;
  model_family: string;
  model_timeout: string;       // UI keeps it as a string for the input
  model_temperature: string;   // UI keeps it as a string for the input
}

const EMPTY_SECTION: ModelSection = {
  model_name: '',
  model_api_key: '',
  model_base_url: '',
  model_family: '',
  model_timeout: '',
  model_temperature: '',
};

interface FormState {
  preferred_language: string;
  // Per-user absolute directory where Midscene HTML reports are written.
  // Empty string = use platform default (data/midscene-reports/).
  // Phase 5 (#41): user-configurable so reports can live outside the repo.
  report_storage_path: string;
  default: ModelSection;
  insight: ModelSection;
  planning: ModelSection;
}

const INITIAL: FormState = {
  preferred_language: '',
  report_storage_path: '',
  default: { ...EMPTY_SECTION },
  insight: { ...EMPTY_SECTION },
  planning: { ...EMPTY_SECTION },
};

interface ServerRow {
  model_name: string | null;
  model_api_key: string | null;
  model_base_url: string | null;
  model_family: string | null;
  model_timeout: number | null;
  model_temperature: number | null;
  insight_model_name: string | null;
  insight_model_api_key: string | null;
  insight_model_base_url: string | null;
  insight_model_family: string | null;
  insight_model_timeout: number | null;
  insight_model_temperature: number | null;
  planning_model_name: string | null;
  planning_model_api_key: string | null;
  planning_model_base_url: string | null;
  planning_model_family: string | null;
  planning_model_timeout: number | null;
  planning_model_temperature: number | null;
  preferred_language: string | null;
  report_storage_path: string | null;
}

const sectionFromRow = (prefix: '' | 'insight_' | 'planning_', row: ServerRow | null): ModelSection => {
  if (!row) return { ...EMPTY_SECTION };
  return {
    model_name: row[`${prefix}model_name` as keyof ServerRow] as string ?? '',
    model_api_key: row[`${prefix}model_api_key` as keyof ServerRow] as string ?? '',
    model_base_url: row[`${prefix}model_base_url` as keyof ServerRow] as string ?? '',
    model_family: row[`${prefix}model_family` as keyof ServerRow] as string ?? '',
    model_timeout: row[`${prefix}model_timeout` as keyof ServerRow] != null ? String(row[`${prefix}model_timeout` as keyof ServerRow]) : '',
    model_temperature: row[`${prefix}model_temperature` as keyof ServerRow] != null ? String(row[`${prefix}model_temperature` as keyof ServerRow]) : '',
  };
};

const formFromRow = (row: ServerRow | null): FormState => ({
  preferred_language: row?.preferred_language ?? '',
  report_storage_path: row?.report_storage_path ?? '',
  default: sectionFromRow('', row),
  insight: sectionFromRow('insight_', row),
  planning: sectionFromRow('planning_', row),
});

const sectionToPayload = (s: ModelSection) => ({
  model_name: s.model_name.trim() || null,
  model_api_key: s.model_api_key.trim() || null,
  model_base_url: s.model_base_url.trim() || null,
  model_family: s.model_family.trim() || null,
  model_timeout: s.model_timeout.trim() === '' ? null : Number(s.model_timeout),
  model_temperature: s.model_temperature.trim() === '' ? null : Number(s.model_temperature),
});

export default function MidsceneConfig() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showKeys, setShowKeys] = useState<Record<keyof FormState, boolean>>({
    default: false,
    insight: false,
    planning: false,
    preferred_language: false,
    report_storage_path: false,
  });

  const fetchConfig = useCallback(() => {
    // Silently fall back to empty form on any failure — first-time users
    // see a blank page they can fill in; transient errors stay invisible.
    apiFetch<ServerRow | null>('/midscene-config').then(res => {
      setForm(formFromRow(res.data ?? null));
      setLoaded(true);
    }).catch(() => {
      setForm(INITIAL);
      setLoaded(true);
    });
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const updateSection = (
    section: 'default' | 'insight' | 'planning',
    field: keyof ModelSection,
    value: string
  ) => {
    setForm(prev => ({
      ...prev,
      [section]: { ...prev[section], [field]: value },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        preferred_language: form.preferred_language.trim() || null,
        // Empty string -> null; server's normalizeString maps both to null so
        // upsertMidsceneConfig clears the override. The route validates the
        // path is absolute, has no '..', and is writable before persisting.
        report_storage_path: form.report_storage_path.trim() || null,
        ...sectionToPayload(form.default),
        insight_model_name: form.insight.model_name.trim() || null,
        insight_model_api_key: form.insight.model_api_key.trim() || null,
        insight_model_base_url: form.insight.model_base_url.trim() || null,
        insight_model_family: form.insight.model_family.trim() || null,
        insight_model_timeout: form.insight.model_timeout.trim() === '' ? null : Number(form.insight.model_timeout),
        insight_model_temperature: form.insight.model_temperature.trim() === '' ? null : Number(form.insight.model_temperature),
        planning_model_name: form.planning.model_name.trim() || null,
        planning_model_api_key: form.planning.model_api_key.trim() || null,
        planning_model_base_url: form.planning.model_base_url.trim() || null,
        planning_model_family: form.planning.model_family.trim() || null,
        planning_model_timeout: form.planning.model_timeout.trim() === '' ? null : Number(form.planning.model_timeout),
        planning_model_temperature: form.planning.model_temperature.trim() === '' ? null : Number(form.planning.model_temperature),
      };

      const res = await apiFetch<ServerRow>('/midscene-config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (res.code === 200) {
        notification.success('Midscene 配置已保存并立即生效');
        setForm(formFromRow(res.data ?? null));
      } else {
        notification.error(res.message || '保存失败');
      }
    } catch (e) {
      notification.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (confirm('确认放弃未保存的修改并重新加载当前配置？')) {
      fetchConfig();
    }
  };

  const renderSection = (
    sectionKey: 'default' | 'insight' | 'planning',
    title: string,
    desc: string,
    section: ModelSection,
  ) => {
    const isKeyVisible = showKeys[sectionKey];
    return (
      <div className="msc-section" key={sectionKey}>
        <div className="msc-section-head">
          <div className="msc-section-title">{title}</div>
          <div className="msc-section-desc">{desc}</div>
        </div>
        <div className="msc-grid">
          <label className="msc-field">
            <span className="msc-label">模型名称 <em>*</em></span>
            <input
              className="msc-input"
              type="text"
              placeholder="例如 gpt-4o、qwen-vl-max、gemini-2.0-flash"
              value={section.model_name}
              onChange={e => updateSection(sectionKey, 'model_name', e.target.value)}
            />
          </label>

          <label className="msc-field">
            <span className="msc-label">API Key <em>*</em></span>
            <div className="msc-key-wrap">
              <input
                className="msc-input"
                type={isKeyVisible ? 'text' : 'password'}
                placeholder="sk-..."
                value={section.model_api_key}
                onChange={e => updateSection(sectionKey, 'model_api_key', e.target.value)}
                autoComplete="off"
              />
              <button
                type="button"
                className="msc-eye"
                onClick={() => setShowKeys(prev => ({ ...prev, [sectionKey]: !prev[sectionKey] }))}
                title={isKeyVisible ? '隐藏' : '显示'}
              >
                {isKeyVisible ? '🙈' : '👁'}
              </button>
            </div>
          </label>

          <label className="msc-field">
            <span className="msc-label">Base URL</span>
            <input
              className="msc-input"
              type="text"
              placeholder="例如 https://api.openai.com/v1  留空走默认值"
              value={section.model_base_url}
              onChange={e => updateSection(sectionKey, 'model_base_url', e.target.value)}
            />
          </label>

          <label className="msc-field">
            <span className="msc-label">模型族 (family)</span>
            <select
              className="msc-input msc-select"
              value={section.model_family}
              onChange={e => updateSection(sectionKey, 'model_family', e.target.value)}
            >
              <option value="">— 留空走默认值 —</option>
              {MIDSCENE_MODEL_FAMILIES.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>

          <label className="msc-field">
            <span className="msc-label">超时 (ms)</span>
            <input
              className="msc-input"
              type="number"
              min={0}
              placeholder="例如 60000"
              value={section.model_timeout}
              onChange={e => updateSection(sectionKey, 'model_timeout', e.target.value)}
            />
          </label>

          <label className="msc-field">
            <span className="msc-label">温度 (temperature)</span>
            <input
              className="msc-input"
              type="number"
              step="0.1"
              min={0}
              max={2}
              placeholder="例如 0.7"
              value={section.model_temperature}
              onChange={e => updateSection(sectionKey, 'model_temperature', e.target.value)}
            />
          </label>
        </div>
      </div>
    );
  };

  if (!loaded) {
    return (
      <div className="sys-root">
        <div className="sys-head"><h2>模型配置配置</h2></div>
        <div className="sys-card">加载中...</div>
      </div>
    );
  }

  return (
    <div className="sys-root">
      <div className="sys-head">
        <h2>模型配置配置</h2>
        <div className="msc-head-desc">
          配置 Midscene AI 代理使用的模型参数。保存后立即对下一次执行生效，无需重启服务。
          留空的字段将沿用服务端环境变量（<code>MIDSCENE_*</code>）的默认值。
        </div>
      </div>

      <div className="sys-card">
        <div className="sys-card-title">全局选项</div>
        <div className="sys-card-desc">影响所有 Midscene AI 调用（断言 / 元素定位 / 报告文案）</div>
        <label className="msc-field msc-field-full">
          <span className="msc-label">首选语言 (preferred_language)</span>
          <input
            className="msc-input"
            type="text"
            placeholder="例如 Chinese、English、Japanese  留空走默认值"
            value={form.preferred_language}
            onChange={e => setForm(prev => ({ ...prev, preferred_language: e.target.value }))}
          />
        </label>
        <label className="msc-field msc-field-full">
          <span className="msc-label">报告存储路径 (report_storage_path)</span>
          <input
            className="msc-input"
            type="text"
            placeholder="例如 /Users/you/reports 或 /var/log/auto-test-reports  留空走默认 data/midscene-reports"
            value={form.report_storage_path}
            onChange={e => setForm(prev => ({ ...prev, report_storage_path: e.target.value }))}
          />
          <span className="msc-hint">
            必须是绝对路径且可写入；保存时服务端会 mkdir + 写探针文件验证。修改后新执行报告写入新路径，历史报告仍在原位。
          </span>
        </label>
      </div>

      {renderSection('default', '默认模型', 'Midscene 默认使用此模型执行所有 AI 操作', form.default)}
      {renderSection('insight', 'Insight 模型', '用于元素查询 / 断言 / 视觉理解（可独立于默认模型以提速/省钱）', form.insight)}
      {renderSection('planning', 'Planning 模型', '用于多步任务规划 / 复杂决策推理', form.planning)}

      <div className="msc-actions">
        <button className="msc-btn-secondary" onClick={handleReset} disabled={saving}>放弃修改</button>
        <button className="msc-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存配置'}
        </button>
      </div>

      <div className="msc-footnote">
        <div className="msc-footnote-title">提示</div>
        <ul>
          <li>三个模型段位字段完全相同时，可只配置「默认模型」并清空另外两段。</li>
          <li>API Key 仅保存到本用户数据库，不会上报到任何第三方服务。</li>
          <li>并发执行多用户用例时，最后一次保存的模型将立即生效（已知限制）。</li>
          <li>报告存储路径变更不影响历史报告；旧报告仍可通过原 URL 访问（中间件按 DB 记录动态解析）。</li>
        </ul>
      </div>
    </div>
  );
}
