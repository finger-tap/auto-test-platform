import { useState, useMemo } from 'react';
import './SelectFunctionModal.css';

interface FunctionInfo {
  name: string;
  label: string;
  description: string;
  args: string;
  example: string;
}

const FUNCTION_GROUPS: { group: string; functions: FunctionInfo[] }[] = [
  {
    group: '字符串处理',
    functions: [
      { name: 'upper', label: '转大写', description: '将字符串转为大写', args: 'str', example: '${upper(name)}' },
      { name: 'lower', label: '转小写', description: '将字符串转为小写', args: 'str', example: '${lower(name)}' },
      { name: 'trim', label: '去空格', description: '去除字符串首尾空格', args: 'str', example: '${trim(name)}' },
      { name: 'concat', label: '拼接', description: '拼接多个字符串', args: 'str1, str2, ...', example: '${concat("Hello", " ", "World")}' },
      { name: 'substring', label: '截取', description: '截取字符串指定位置', args: 'str, start, end?', example: '${substring(text, 0, 5)}' },
      { name: 'replace', label: '替换', description: '替换字符串中的内容', args: 'str, search, replacement', example: '${replace(url, "http", "https")}' },
      { name: 'split', label: '分割', description: '分割字符串并取第N段', args: 'str, delimiter, index?', example: '${split(path, "/", 2)}' },
      { name: 'length', label: '长度', description: '返回字符串长度', args: 'str', example: '${length(name)}' },
      { name: 'contains', label: '包含', description: '判断是否包含子串', args: 'str, search', example: '${contains(email, "@")}' },
      { name: 'startsWith', label: '开头', description: '判断是否以某字符串开头', args: 'str, prefix', example: '${startsWith(url, "https")}' },
      { name: 'endsWith', label: '结尾', description: '判断是否以某字符串结尾', args: 'str, suffix', example: '${endsWith(file, ".json")}' },
    ],
  },
  {
    group: '数值计算',
    functions: [
      { name: 'add', label: '加法', description: '两数相加', args: 'a, b', example: '${add(price, tax)}' },
      { name: 'sub', label: '减法', description: '两数相减', args: 'a, b', example: '${sub(total, discount)}' },
      { name: 'mul', label: '乘法', description: '两数相乘', args: 'a, b', example: '${mul(price, quantity)}' },
      { name: 'div', label: '除法', description: '两数相除', args: 'a, b', example: '${div(amount, count)}' },
      { name: 'round', label: '四舍五入', description: '保留指定小数位', args: 'num, decimals?', example: '${round(3.14159, 2)}' },
      { name: 'floor', label: '向下取整', description: '返回小于等于该数的最大整数', args: 'num', example: '${floor(3.9)}' },
      { name: 'ceil', label: '向上取整', description: '返回大于等于该数的最小整数', args: 'num', example: '${ceil(3.1)}' },
      { name: 'min', label: '最小值', description: '返回最小值', args: 'num1, num2, ...', example: '${min(a, b, c)}' },
      { name: 'max', label: '最大值', description: '返回最大值', args: 'num1, num2, ...', example: '${max(a, b, c)}' },
    ],
  },
  {
    group: '日期时间',
    functions: [
      { name: 'now', label: '当前时间', description: '返回当前时间，可指定格式', args: 'format?', example: '${now("YYYY-MM-DD HH:mm:ss")}' },
      { name: 'timestamp', label: '时间戳', description: '返回当前 Unix 时间戳（毫秒）', args: '', example: '${timestamp()}' },
      { name: 'dateAdd', label: '日期偏移', description: '对日期加减时间', args: 'unit, amount, base?', example: '${dateAdd("day", 7)}' },
      { name: 'formatDate', label: '格式化日期', description: '将日期字符串按格式输出', args: 'dateStr, format', example: '${formatDate(created_at, "YYYY-MM-DD")}' },
    ],
  },
  {
    group: '编码转换',
    functions: [
      { name: 'base64Encode', label: 'Base64编码', description: '将字符串进行 Base64 编码', args: 'str', example: '${base64Encode(text)}' },
      { name: 'base64Decode', label: 'Base64解码', description: '将 Base64 字符串解码', args: 'str', example: '${base64Decode(encoded)}' },
      { name: 'urlEncode', label: 'URL编码', description: '对字符串进行 URL 编码', args: 'str', example: '${urlEncode(keyword)}' },
      { name: 'urlDecode', label: 'URL解码', description: '对 URL 编码字符串解码', args: 'str', example: '${urlDecode(encodedParam)}' },
    ],
  },
  {
    group: '随机数据',
    functions: [
      { name: 'randomInt', label: '随机整数', description: '生成指定范围内的随机整数', args: 'min, max', example: '${randomInt(1, 100)}' },
      { name: 'randomFloat', label: '随机小数', description: '生成指定范围内随机小数', args: 'min, max, decimals?', example: '${randomFloat(0, 100, 2)}' },
      { name: 'randomString', label: '随机字符串', description: '生成指定长度随机字符串', args: 'length, charset?', example: '${randomString(16)}' },
      { name: 'randomMobile', label: '随机手机号', description: '生成随机中国大陆手机号', args: '', example: '${randomMobile()}' },
      { name: 'randomEmail', label: '随机邮箱', description: '生成随机邮箱地址', args: '', example: '${randomEmail()}' },
      { name: 'randomUUID', label: '随机UUID', description: '生成标准 UUID', args: '', example: '${randomUUID()}' },
      { name: 'randomChoice', label: '随机选择', description: '从多个选项中随机选择一个', args: 'opt1, opt2, ...', example: '${randomChoice("A", "B", "C")}' },
    ],
  },
  {
    group: 'JSON处理',
    functions: [
      { name: 'jsonGet', label: 'JSON取值', description: '从 JSON 字符串中提取字段', args: 'jsonStr, path', example: '${jsonGet(body, "data.token")}' },
      { name: 'jsonStringify', label: 'JSON序列化', description: '将对象转为 JSON 字符串', args: 'obj', example: '${jsonStringify(obj)}' },
    ],
  },
];

interface SelectFunctionModalProps {
  open: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
}

export default function SelectFunctionModal({ open, onClose, onInsert }: SelectFunctionModalProps) {
  const [search, setSearch] = useState('');
  const [activeGroup, setActiveGroup] = useState(FUNCTION_GROUPS[0].group);

  const filtered = useMemo(() => {
    if (!search.trim()) return FUNCTION_GROUPS;
    const q = search.toLowerCase();
    return FUNCTION_GROUPS.map(g => ({
      ...g,
      functions: g.functions.filter(
        f => f.name.includes(q) || f.label.includes(q) || f.description.includes(q)
      ),
    })).filter(g => g.functions.length > 0);
  }, [search]);

  const handleInsert = (fn: FunctionInfo) => {
    onInsert(fn.example);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="sfm-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sfm-modal">
        <div className="sfm-header">
          <div className="sfm-title">插入函数</div>
          <input
            className="sfm-search"
            placeholder="搜索函数..."
            value={search}
            onChange={e => { setSearch(e.target.value); if (e.target.value) setActiveGroup(filtered[0]?.group || ''); }}
            autoFocus
          />
          <button className="sfm-close" onClick={onClose}>✕</button>
        </div>
        <div className="sfm-body">
          <div className="sfm-groups">
            {filtered.map(g => (
              <button
                key={g.group}
                className={`sfm-group-btn ${activeGroup === g.group ? 'active' : ''}`}
                onClick={() => setActiveGroup(g.group)}
              >
                {g.group}
                <span className="sfm-group-count">{g.functions.length}</span>
              </button>
            ))}
          </div>
          <div className="sfm-list">
            {(() => {
              const group = filtered.find(g => g.group === activeGroup);
              if (!group) return <div className="sfm-empty">没有找到匹配的函数</div>;
              return group.functions.map(fn => (
                <div key={fn.name} className="sfm-item" onClick={() => handleInsert(fn)}>
                  <div className="sfm-item-top">
                    <span className="sfm-item-name">{fn.label}</span>
                    <code className="sfm-item-example">{fn.example}</code>
                  </div>
                  <div className="sfm-item-desc">{fn.description}</div>
                  <div className="sfm-item-args">参数: {fn.args}</div>
                </div>
              ));
            })()}
          </div>
        </div>
        <div className="sfm-footer">
          点击函数即可插入到脚本中。支持 <code>${'${funcName(arg)}'}</code> 语法。
        </div>
      </div>
    </div>
  );
}