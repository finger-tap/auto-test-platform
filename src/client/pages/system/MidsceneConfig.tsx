import { useState, useEffect, useCallback } from 'react';
import FormSelect from '../../components/FormSelect';
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

// 推理力度可选值(对应 OpenAI/Anthropic reasoning effort 参数)
const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;

// One row shape — used for the default / insight / planning intent sections.
interface ModelSection {
  // 基础字段
  model_name: string;
  model_api_key: string;
  model_base_url: string;
  model_family: string;
  model_timeout: string;       // UI keeps it as a string for the input
  model_temperature: string;   // UI keeps it as a string for the input
  // 2026-06-14 扩展字段(留空走默认)
  model_retry_count: string;
  model_retry_interval: string;
  model_http_proxy: string;
  model_socks_proxy: string;
  model_extra_body_json: string;
  model_init_config_json: string;
  model_reasoning_enabled: string;  // '0' / '1' / '' (空=默认)
  model_reasoning_effort: string;
  model_reasoning_budget: string;
}

const EMPTY_SECTION: ModelSection = {
  model_name: '',
  model_api_key: '',
  model_base_url: '',
  model_family: '',
  model_timeout: '',
  model_temperature: '',
  model_retry_count: '',
  model_retry_interval: '',
  model_http_proxy: '',
  model_socks_proxy: '',
  model_extra_body_json: '',
  model_init_config_json: '',
  model_reasoning_enabled: '',
  model_reasoning_effort: '',
  model_reasoning_budget: '',
};

interface FormState {
  preferred_language: string;
  // Per-user absolute directory where Midscene HTML reports are written.
  // Empty string = use platform default (data/midscene-reports/).
  report_storage_path: string;
  // 2026-06-14 执行行为(全局,非段位)
  replanning_cycle_limit: string;
  wait_after_action: string;
  screenshot_shrink_factor: string;
  default: ModelSection;
  insight: ModelSection;
  planning: ModelSection;
}

const INITIAL: FormState = {
  preferred_language: '',
  report_storage_path: '',
  replanning_cycle_limit: '',
  wait_after_action: '',
  screenshot_shrink_factor: '',
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
  model_retry_count: number | null;
  model_retry_interval: number | null;
  model_http_proxy: string | null;
  model_socks_proxy: string | null;
  model_extra_body_json: string | null;
  model_init_config_json: string | null;
  model_reasoning_enabled: number | null;
  model_reasoning_effort: string | null;
  model_reasoning_budget: number | null;
  insight_model_name: string | null;
  insight_model_api_key: string | null;
  insight_model_base_url: string | null;
  insight_model_family: string | null;
  insight_model_timeout: number | null;
  insight_model_temperature: number | null;
  insight_model_retry_count: number | null;
  insight_model_retry_interval: number | null;
  insight_model_http_proxy: string | null;
  insight_model_socks_proxy: string | null;
  insight_model_extra_body_json: string | null;
  insight_model_init_config_json: string | null;
  insight_model_reasoning_enabled: number | null;
  insight_model_reasoning_effort: string | null;
  insight_model_reasoning_budget: number | null;
  planning_model_name: string | null;
  planning_model_api_key: string | null;
  planning_model_base_url: string | null;
  planning_model_family: string | null;
  planning_model_timeout: number | null;
  planning_model_temperature: number | null;
  planning_model_retry_count: number | null;
  planning_model_retry_interval: number | null;
  planning_model_http_proxy: string | null;
  planning_model_socks_proxy: string | null;
  planning_model_extra_body_json: string | null;
  planning_model_init_config_json: string | null;
  planning_model_reasoning_enabled: number | null;
  planning_model_reasoning_effort: string | null;
  planning_model_reasoning_budget: number | null;
  preferred_language: string | null;
  report_storage_path: string | null;
  replanning_cycle_limit: number | null;
  wait_after_action: number | null;
  screenshot_shrink_factor: number | null;
}

const numToStr = (v: number | null | undefined): string =>
  v != null && Number.isFinite(v) ? String(v) : '';

const sectionFromRow = (prefix: '' | 'insight_' | 'planning_', row: ServerRow | null): ModelSection => {
  if (!row) return { ...EMPTY_SECTION };
  return {
    model_name: row[`${prefix}model_name` as keyof ServerRow] as string ?? '',
    model_api_key: row[`${prefix}model_api_key` as keyof ServerRow] as string ?? '',
    model_base_url: row[`${prefix}model_base_url` as keyof ServerRow] as string ?? '',
    model_family: row[`${prefix}model_family` as keyof ServerRow] as string ?? '',
    model_timeout: numToStr(row[`${prefix}model_timeout` as keyof ServerRow] as number | null),
    model_temperature: numToStr(row[`${prefix}model_temperature` as keyof ServerRow] as number | null),
    model_retry_count: numToStr(row[`${prefix}model_retry_count` as keyof ServerRow] as number | null),
    model_retry_interval: numToStr(row[`${prefix}model_retry_interval` as keyof ServerRow] as number | null),
    model_http_proxy: row[`${prefix}model_http_proxy` as keyof ServerRow] as string ?? '',
    model_socks_proxy: row[`${prefix}model_socks_proxy` as keyof ServerRow] as string ?? '',
    model_extra_body_json: row[`${prefix}model_extra_body_json` as keyof ServerRow] as string ?? '',
    model_init_config_json: row[`${prefix}model_init_config_json` as keyof ServerRow] as string ?? '',
    model_reasoning_enabled: (() => {
      const v = row[`${prefix}model_reasoning_enabled` as keyof ServerRow] as number | null;
      return v == null ? '' : (v ? '1' : '0');
    })(),
    model_reasoning_effort: row[`${prefix}model_reasoning_effort` as keyof ServerRow] as string ?? '',
    model_reasoning_budget: numToStr(row[`${prefix}model_reasoning_budget` as keyof ServerRow] as number | null),
  };
};

const formFromRow = (row: ServerRow | null): FormState => ({
  preferred_language: row?.preferred_language ?? '',
  report_storage_path: row?.report_storage_path ?? '',
  replanning_cycle_limit: numToStr(row?.replanning_cycle_limit),
  wait_after_action: numToStr(row?.wait_after_action),
  screenshot_shrink_factor: numToStr(row?.screenshot_shrink_factor),
  default: sectionFromRow('', row),
  insight: sectionFromRow('insight_', row),
  planning: sectionFromRow('planning_', row),
});

// 空字符串 → null(让 buildEnvMap 跳过,保留默认);数值字段转 Number
const numOrNull = (s: string): number | null => (s.trim() === '' ? null : (Number.isFinite(Number(s)) ? Number(s) : null));
const strOrNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

const sectionToPayload = (prefix: '' | 'insight_' | 'planning_', s: ModelSection) => ({
  [`${prefix}model_name`]: strOrNull(s.model_name),
  [`${prefix}model_api_key`]: strOrNull(s.model_api_key),
  [`${prefix}model_base_url`]: strOrNull(s.model_base_url),
  [`${prefix}model_family`]: strOrNull(s.model_family),
  [`${prefix}model_timeout`]: numOrNull(s.model_timeout),
  [`${prefix}model_temperature`]: numOrNull(s.model_temperature),
  [`${prefix}model_retry_count`]: numOrNull(s.model_retry_count),
  [`${prefix}model_retry_interval`]: numOrNull(s.model_retry_interval),
  [`${prefix}model_http_proxy`]: strOrNull(s.model_http_proxy),
  [`${prefix}model_socks_proxy`]: strOrNull(s.model_socks_proxy),
  [`${prefix}model_extra_body_json`]: strOrNull(s.model_extra_body_json),
  [`${prefix}model_init_config_json`]: strOrNull(s.model_init_config_json),
  [`${prefix}model_reasoning_enabled`]: s.model_reasoning_enabled === '' ? null : Number(s.model_reasoning_enabled),
  [`${prefix}model_reasoning_effort`]: strOrNull(s.model_reasoning_effort),
  [`${prefix}model_reasoning_budget`]: numOrNull(s.model_reasoning_budget),
});

export default function MidsceneConfig() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  // 每个段位的「高级选项」折叠态(默认模型默认展开,insight/planning 默认折叠)
  const [advancedOpen, setAdvancedOpen] = useState<Record<'default' | 'insight' | 'planning', boolean>>({
    default: false,
    insight: false,
    planning: false,
  });
  const [showKeys, setShowKeys] = useState<Record<'default' | 'insight' | 'planning', boolean>>({
    default: false,
    insight: false,
    planning: false,
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
        preferred_language: strOrNull(form.preferred_language),
        report_storage_path: strOrNull(form.report_storage_path),
        replanning_cycle_limit: numOrNull(form.replanning_cycle_limit),
        wait_after_action: numOrNull(form.wait_after_action),
        screenshot_shrink_factor: numOrNull(form.screenshot_shrink_factor),
        ...sectionToPayload('', form.default),
        ...sectionToPayload('insight_', form.insight),
        ...sectionToPayload('planning_', form.planning),
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

  const handleReset = async () => {
    const ok = await notification.confirm('确认放弃未保存的修改并重新加载当前配置？');
    if (!ok) return;
    fetchConfig();
  };

  const renderSection = (
    sectionKey: 'default' | 'insight' | 'planning',
    title: string,
    desc: string,
    section: ModelSection,
  ) => {
    const isKeyVisible = showKeys[sectionKey];
    const isAdvancedOpen = advancedOpen[sectionKey];
    const hasAdvancedValues =
      section.model_retry_count || section.model_retry_interval ||
      section.model_http_proxy || section.model_socks_proxy ||
      section.model_extra_body_json || section.model_init_config_json ||
      section.model_reasoning_enabled || section.model_reasoning_effort || section.model_reasoning_budget;
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
            <FormSelect
              className="msc-input"
              value={section.model_family}
              options={[
                { value: '', label: '— 留空走默认值 —' },
                ...MIDSCENE_MODEL_FAMILIES.map(f => ({ value: f, label: f })),
              ]}
              onChange={v => updateSection(sectionKey, 'model_family', v)}
            />
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

        {/* 高级选项:折叠,默认隐藏,有值时显示角标提示 */}
        <button
          type="button"
          className="msc-advanced-toggle"
          onClick={() => setAdvancedOpen(prev => ({ ...prev, [sectionKey]: !prev[sectionKey] }))}
          aria-expanded={isAdvancedOpen}
        >
          <span>{isAdvancedOpen ? '▾' : '▸'}</span> 高级选项(重试 / 代理 / 推理 / 扩展请求体)
          {!isAdvancedOpen && hasAdvancedValues && <span className="msc-advanced-badge">已配置</span>}
        </button>
        {isAdvancedOpen && (
          <div className="msc-grid msc-advanced-grid">
            <label className="msc-field">
              <span className="msc-label">重试次数</span>
              <input
                className="msc-input"
                type="number"
                min={0}
                placeholder="留空走默认(0)"
                value={section.model_retry_count}
                onChange={e => updateSection(sectionKey, 'model_retry_count', e.target.value)}
              />
              <span className="msc-hint">单次 AI 调用失败时的重试次数。网络不稳定时可调大。默认 0。</span>
            </label>

            <label className="msc-field">
              <span className="msc-label">重试间隔 (ms)</span>
              <input
                className="msc-input"
                type="number"
                min={0}
                placeholder="留空走默认(1000)"
                value={section.model_retry_interval}
                onChange={e => updateSection(sectionKey, 'model_retry_interval', e.target.value)}
              />
              <span className="msc-hint">两次重试之间的等待毫秒数。默认 1000ms。</span>
            </label>

            <label className="msc-field">
              <span className="msc-label">HTTP 代理</span>
              <input
                className="msc-input"
                type="text"
                placeholder="例如 http://127.0.0.1:7890"
                value={section.model_http_proxy}
                onChange={e => updateSection(sectionKey, 'model_http_proxy', e.target.value)}
              />
              <span className="msc-hint">企业内网或科学上网的 HTTP/HTTPS 代理地址。留空不走代理。</span>
            </label>

            <label className="msc-field">
              <span className="msc-label">SOCKS 代理</span>
              <input
                className="msc-input"
                type="text"
                placeholder="例如 socks5://127.0.0.1:1080"
                value={section.model_socks_proxy}
                onChange={e => updateSection(sectionKey, 'model_socks_proxy', e.target.value)}
              />
              <span className="msc-hint">SOCKS5 代理地址,与 HTTP 代理二选一。留空不走代理。</span>
            </label>

            <label className="msc-field">
              <span className="msc-label">扩展请求体 (extra_body_json)</span>
              <input
                className="msc-input"
                type="text"
                placeholder='JSON 字符串,例如 {"enable_search":true}'
                value={section.model_extra_body_json}
                onChange={e => updateSection(sectionKey, 'model_extra_body_json', e.target.value)}
              />
              <span className="msc-hint">附加到每次 AI 请求 body 的 JSON 字符串,用于厂商私有参数(如联网搜索开关)。</span>
            </label>

            <label className="msc-field">
              <span className="msc-label">初始化配置 (init_config_json)</span>
              <input
                className="msc-input"
                type="text"
                placeholder='例如 {"defaultHeaders":{"X-Org":"abc"}}'
                value={section.model_init_config_json}
                onChange={e => updateSection(sectionKey, 'model_init_config_json', e.target.value)}
              />
              <span className="msc-hint">OpenAI client 初始化配置 JSON,可注入自定义 header 等。</span>
            </label>

            <label className="msc-field">
              <span className="msc-label">推理开关 (reasoning_enabled)</span>
              <FormSelect
                className="msc-input"
                value={section.model_reasoning_enabled}
                options={[
                  { value: '', label: '— 留空走默认(关) —' },
                  { value: '1', label: '开启' },
                  { value: '0', label: '关闭' },
                ]}
                onChange={v => updateSection(sectionKey, 'model_reasoning_enabled', v)}
              />
              <span className="msc-hint">开启后启用 o1/r1 类推理模型的后台思考。仅对支持 reasoning 的模型有效。</span>
            </label>

            <label className="msc-field">
              <span className="msc-label">推理力度 (reasoning_effort)</span>
              <FormSelect
                className="msc-input"
                value={section.model_reasoning_effort}
                options={[
                  { value: '', label: '— 留空走默认 —' },
                  ...REASONING_EFFORTS.map(f => ({ value: f, label: f })),
                ]}
                onChange={v => updateSection(sectionKey, 'model_reasoning_effort', v)}
              />
              <span className="msc-hint">控制推理深度:low 快但浅,high 深但慢。需先开启推理开关。</span>
            </label>

            <label className="msc-field">
              <span className="msc-label">推理预算 (reasoning_budget)</span>
              <input
                className="msc-input"
                type="number"
                min={0}
                placeholder="推理 token 预算上限"
                value={section.model_reasoning_budget}
                onChange={e => updateSection(sectionKey, 'model_reasoning_budget', e.target.value)}
              />
              <span className="msc-hint">推理过程的最大 token 预算。需先开启推理开关。</span>
            </label>
          </div>
        )}
      </div>
    );
  };

  if (!loaded) {
    return (
      <div className="sys-root">
        <div className="sys-head"><h2>模型配置</h2></div>
        <div className="sys-card">加载中...</div>
      </div>
    );
  }

  return (
    <div className="sys-root">
      <div className="sys-head">
        <h2>模型配置</h2>
        <div className="msc-head-desc">
          配置 Midscene AI 代理使用的模型与执行参数。保存后立即对下一次执行生效，无需重启服务。
          留空的字段将沿用服务端环境变量（<code>MIDSCENE_*</code>）或 Midscene 内置默认值。
        </div>
      </div>

      <div className="sys-card">
        <div className="sys-card-title">全局选项</div>
        <div className="sys-card-desc">影响所有 Midscene AI 调用与报告落盘</div>
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

      {/* 执行行为 Card — 全局,作用于 Agent 构造 */}
      <div className="msc-section">
        <div className="msc-section-head">
          <div className="msc-section-title">执行行为</div>
          <div className="msc-section-desc">控制 Agent 单次任务的执行节奏,作用于 Web / PC / 移动端所有用例</div>
        </div>
        <div className="msc-grid">
          <label className="msc-field">
            <span className="msc-label">重规划循环上限</span>
            <input
              className="msc-input"
              type="number"
              min={1}
              placeholder="留空走默认(20,vlm-ui-tars 为 40)"
              value={form.replanning_cycle_limit}
              onChange={e => setForm(prev => ({ ...prev, replanning_cycle_limit: e.target.value }))}
            />
            <span className="msc-hint">
              单个任务 AI 规划-执行的最大循环次数。达到上限仍未完成则判失败。值越大越能完成复杂任务,但耗时与 token 消耗也越高。默认 20(vlm-ui-tars 模型族为 40)。
            </span>
          </label>

          <label className="msc-field">
            <span className="msc-label">动作后等待 (ms)</span>
            <input
              className="msc-input"
              type="number"
              min={0}
              placeholder="留空走默认(300)"
              value={form.wait_after_action}
              onChange={e => setForm(prev => ({ ...prev, wait_after_action: e.target.value }))}
            />
            <span className="msc-hint">
              每执行一个动作后等待界面稳定的毫秒数。界面动画较多或网络较慢的站点可调大,以保证 AI 看到的是动作完成后的页面。默认 300ms。
            </span>
          </label>

          <label className="msc-field">
            <span className="msc-label">截图缩放因子</span>
            <input
              className="msc-input"
              type="number"
              min={1}
              step="0.5"
              placeholder="留空走默认(1,不缩小)"
              value={form.screenshot_shrink_factor}
              onChange={e => setForm(prev => ({ ...prev, screenshot_shrink_factor: e.target.value }))}
            />
            <span className="msc-hint">
              将截图按此因子缩小后再送给 AI,以降低 token 消耗。必须 ≥1。例如填 2 表示物理像素减半。过大会损失定位精度。默认 1(不缩小)。
            </span>
          </label>
        </div>
      </div>

      {renderSection('default', '默认模型', 'Midscene 默认使用此模型执行所有 AI 操作', form.default)}
      {renderSection('insight', 'Insight 模型', '用于元素查询 / 断言 / 视觉理解(可独立于默认模型以提速/省钱)', form.insight)}
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
          <li>「高级选项」里的重试 / 代理 / 推理字段留空即走默认值,通常无需配置。</li>
          <li>API Key 仅保存到本用户数据库，不会上报到任何第三方服务。</li>
          <li>并发执行多用户用例时，最后一次保存的模型将立即生效(已知限制,单机场景不构成问题)。</li>
          <li>报告存储路径变更不影响历史报告；旧报告仍可通过原 URL 访问(中间件按 DB 记录动态解析)。</li>
        </ul>
      </div>
    </div>
  );
}
