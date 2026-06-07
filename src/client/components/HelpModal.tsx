import { useState } from 'react';
import './HelpModal.css';

interface FuncDoc {
  name: string;
  syntax: string;
  desc: string;
  example: string;
}

interface Category {
  label: string;
  funcs: FuncDoc[];
}

const CATEGORIES: Category[] = [
  {
    label: '字符串处理',
    funcs: [
      { name: 'upper', syntax: '${upper(str)}', desc: '将字符串转为大写', example: '${upper(name)} → "JOHN"' },
      { name: 'lower', syntax: '${lower(str)}', desc: '将字符串转为小写', example: '${lower(NAME)} → "name"' },
      { name: 'trim', syntax: '${trim(str)}', desc: '去除首尾空白字符', example: '${trim("  hi  ")} → "hi"' },
      { name: 'concat', syntax: '${concat(arg1, arg2, ...)}', desc: '拼接多个字符串', example: '${concat(a, b)} → "ab"' },
      { name: 'substring', syntax: '${substring(str, start, end?)}', desc: '截取子串，支持结束位置', example: '${substring(str, 0, 3)}' },
      { name: 'replace', syntax: '${replace(str, search, replacement)}', desc: '替换所有匹配项', example: '${replace(url, "http", "https")}' },
      { name: 'split', syntax: '${split(str, delimiter, index?)}', desc: '分割字符串，可选取第N段', example: '${split("a,b", ",", 0)} → "a"' },
      { name: 'length', syntax: '${length(str)}', desc: '返回字符串长度', example: '${length("abc")} → 3' },
      { name: 'contains', syntax: '${contains(str, search)}', desc: '判断是否包含子串，返回布尔值', example: '${contains(email, "@")} → true' },
      { name: 'startsWith', syntax: '${startsWith(str, prefix)}', desc: '判断是否以某前缀开头', example: '${startsWith(url, "https")}' },
      { name: 'endsWith', syntax: '${endsWith(str, suffix)}', desc: '判断是否以某后缀结尾', example: '${endsWith(file, ".json")}' },
    ],
  },
  {
    label: '数值计算',
    funcs: [
      { name: 'add', syntax: '${add(a, b)}', desc: '加法，支持自动类型转换', example: '${add("1", 2)} → 3' },
      { name: 'sub', syntax: '${sub(a, b)}', desc: '减法', example: '${sub(10, 3)} → 7' },
      { name: 'mul', syntax: '${mul(a, b)}', desc: '乘法', example: '${mul(3, 4)} → 12' },
      { name: 'div', syntax: '${div(a, b)}', desc: '除法，分母为0时返回0', example: '${div(10, 3)} → 3.333...' },
      { name: 'round', syntax: '${round(num, decimals?)}', desc: '四舍五入，可选小数位数', example: '${round(3.14159, 2)} → 3.14' },
      { name: 'floor', syntax: '${floor(num)}', desc: '向下取整', example: '${floor(3.9)} → 3' },
      { name: 'ceil', syntax: '${ceil(num)}', desc: '向上取整', example: '${ceil(3.1)} → 4' },
      { name: 'min', syntax: '${min(a, b, ...)}', desc: '返回最小值', example: '${min(3, 1, 4)} → 1' },
      { name: 'max', syntax: '${max(a, b, ...)}', desc: '返回最大值', example: '${max(3, 1, 4)} → 4' },
    ],
  },
  {
    label: '日期时间',
    funcs: [
      { name: 'now', syntax: '${now(format?)}', desc: '当前时间，可选格式', example: '${now("YYYY-MM-DD")} → "2026-05-19"' },
      { name: 'timestamp', syntax: '${timestamp()}', desc: '当前时间戳（毫秒）', example: '${timestamp()} → "1747632000000"' },
      { name: 'dateAdd', syntax: '${dateAdd(unit, amount, base?)}', desc: '日期加减，支持 y/M/d/h/min/s/ms', example: '${dateAdd("day", 1)} → 明天' },
      { name: 'formatDate', syntax: '${formatDate(dateStr, format)}', desc: '格式化日期', example: '${formatDate(ts, "HH:mm:ss")}' },
    ],
  },
  {
    label: '编码转换',
    funcs: [
      { name: 'base64Encode', syntax: '${base64Encode(str)}', desc: 'Base64 编码', example: '${base64Encode("abc")} → "YWJj"' },
      { name: 'base64Decode', syntax: '${base64Decode(str)}', desc: 'Base64 解码', example: '${base64Decode("YWJj")} → "abc"' },
      { name: 'md5', syntax: '${md5(str)}', desc: 'MD5 哈希（简单实现）', example: '${md5("hello")}' },
      { name: 'urlEncode', syntax: '${urlEncode(str)}', desc: 'URL 编码', example: '${urlEncode("a b")} → "a%20b"' },
      { name: 'urlDecode', syntax: '${urlDecode(str)}', desc: 'URL 解码', example: '${urlDecode("a%20b")} → "a b"' },
    ],
  },
  {
    label: '随机数据',
    funcs: [
      { name: 'randomInt', syntax: '${randomInt(min, max)}', desc: '随机整数，闭区间', example: '${randomInt(1, 100)} → 42' },
      { name: 'randomFloat', syntax: '${randomFloat(min, max, decimals?)}', desc: '随机浮点数，可选小数位', example: '${randomFloat(0, 1, 4)} → 0.3827' },
      { name: 'randomString', syntax: '${randomString(length, charset?)}', desc: '随机字符串，可选字符集', example: '${randomString(8)} → "aB3xK9zQ"' },
      { name: 'randomMobile', syntax: '${randomMobile()}', desc: '随机中国手机号', example: '${randomMobile()} → "13812345678"' },
      { name: 'randomEmail', syntax: '${randomEmail()}', desc: '随机邮箱', example: '${randomEmail()} → "ab12cd34@qq.com"' },
      { name: 'randomUUID', syntax: '${randomUUID()}', desc: '随机 UUID', example: '${randomUUID()} → "a1b2c3d4-..."' },
      { name: 'randomChoice', syntax: '${randomChoice(arg1, arg2, ...)}', desc: '随机选择一项', example: '${randomChoice("北京", "上海", "广州")}' },
    ],
  },
  {
    label: 'JSON处理',
    funcs: [
      { name: 'jsonGet', syntax: '${jsonGet(jsonStr, path)}', desc: '从 JSON 字符串提取值，支持点号路径', example: '${jsonGet(body, "data.id")}' },
      { name: 'jsonStringify', syntax: '${jsonStringify(obj)}', desc: '将对象转为 JSON 字符串', example: '${jsonStringify(obj)}' },
    ],
  },
];

export default function HelpModal({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState(0);
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? CATEGORIES.map(c => ({
        ...c,
        funcs: c.funcs.filter(f =>
          f.name.includes(search.trim()) ||
          f.desc.includes(search.trim()) ||
          f.syntax.includes(search.trim())
        ),
      })).filter(c => c.funcs.length > 0)
    : null;

  const displayFuncs = search.trim()
    ? null
    : CATEGORIES[activeTab].funcs;

  return (
    <div className="help-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="help-modal">
        <div className="help-modal-header">
          <span className="help-modal-title">📖 内置函数帮助</span>
          <button className="help-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="help-modal-search">
          <input
            className="help-search-input"
            placeholder="搜索函数名称、描述或语法..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        {!search.trim() && (
          <div className="help-modal-tabs">
            {CATEGORIES.map((c, i) => (
              <button
                key={i}
                className={`help-tab ${activeTab === i ? 'active' : ''}`}
                onClick={() => setActiveTab(i)}
              >
                {c.label}
                <span className="help-tab-count">{c.funcs.length}</span>
              </button>
            ))}
          </div>
        )}

        <div className="help-modal-body">
          {search.trim() ? (
            filtered!.length === 0 ? (
              <div className="help-empty">没有找到匹配的函数</div>
            ) : (
              filtered!.map(cat => (
                <div key={cat.label} className="help-category-group">
                  <div className="help-category-label">{cat.label}</div>
                  {cat.funcs.map(f => (
                    <div key={f.name} className="help-func-item">
                      <div className="help-func-name">{f.name}</div>
                      <div className="help-func-desc">{f.desc}</div>
                      <div className="help-func-code">{f.syntax}</div>
                      <div className="help-func-example">示例：{f.example}</div>
                    </div>
                  ))}
                </div>
              ))
            )
          ) : (
            (displayFuncs ?? []).map(f => (
              <div key={f.name} className="help-func-item">
                <div className="help-func-name">{f.name}</div>
                <div className="help-func-desc">{f.desc}</div>
                <div className="help-func-code">{f.syntax}</div>
                <div className="help-func-example">示例：{f.example}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}