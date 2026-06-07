import yaml from 'js-yaml';
import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPIV3 } from 'openapi-types';
// eslint-disable-next-line @typescript-eslint/no-namespace
import type { OpenAPIV2 } from 'openapi-types';

export interface ParsedApi {
  name: string;
  method: string;
  url: string;
  description: string;
  tags: string[];
  headers: Record<string, string>;
  body: string;
  content_type: string;
}

export interface ParseResult {
  format: 'openapi3' | 'swagger2' | 'postman' | 'unknown';
  title: string;
  version: string;
  baseUrl: string;
  apis: ParsedApi[];
}

/** 判断文件格式 */
function detectFormat(content: unknown): 'openapi3' | 'swagger2' | 'postman' | 'unknown' {
  if (typeof content !== 'object' || content === null) return 'unknown';
  const doc = content as Record<string, unknown>;
  if (doc.openapi && String(doc.openapi).startsWith('3')) return 'openapi3';
  if (doc.swagger === '2.0') return 'swagger2';
  if (doc.info && doc.item) return 'postman';
  return 'unknown';
}

/** 加载 YAML 或 JSON */
function loadDocument(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return yaml.load(raw) as unknown;
  }
}

/** 从 OpenAPI 3.x 解析 */
function parseOpenAPI3(doc: OpenAPIV3.Document): ParseResult {
  const title = doc.info?.title || 'Untitled';
  const version = doc.info?.version || '1.0.0';
  // 服务器 URL
  const servers = doc.servers || [];
  const baseUrl = (servers[0] as { url: string })?.url || '';

  const apis: ParsedApi[] = [];

  for (const [path, pathItem] of Object.entries(doc.paths || {})) {
    const methods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];
    for (const method of methods) {
      const operation = (pathItem as Record<string, unknown>)[method] as OpenAPIV3.OperationObject | undefined;
      if (!operation) continue;

      const params = (operation.parameters || []) as OpenAPIV3.ParameterObject[];
      const headers: Record<string, string> = {};
      let queryParams: Record<string, string> = {};
      const pathParams: Record<string, string> = {};

      for (const p of params) {
        if (p.in === 'header' && p.schema) {
          headers[p.name] = String((p.schema as OpenAPIV3.SchemaObject).default ?? '');
        } else if (p.in === 'query' && p.schema) {
          queryParams[p.name] = String((p.schema as OpenAPIV3.SchemaObject).default ?? '');
        } else if (p.in === 'path' && p.schema) {
          pathParams[p.name] = String((p.schema as OpenAPIV3.SchemaObject).default ?? '');
        }
      }

      // 构建 URL（带路径参数占位）
      let fullUrl = baseUrl + path;
      for (const [k, v] of Object.entries(pathParams)) {
        fullUrl = fullUrl.replace(`{${k}}`, v || `{${k}}`);
      }
      if (Object.keys(queryParams).length > 0) {
        const qs = new URLSearchParams(queryParams).toString();
        fullUrl = fullUrl + '?' + qs;
      }

      // 请求体
      let body = '';
      let content_type = '';
      const reqBody = operation.requestBody as OpenAPIV3.RequestBodyObject | undefined;
      if (reqBody?.content) {
        const ct = Object.keys(reqBody.content)[0];
        content_type = ct;
        const schema = reqBody.content[ct]?.schema;
        if (schema) {
          body = JSON.stringify(resolveSchema(schema as OpenAPIV3.SchemaObject), null, 2);
        }
      }

      // 标签
      const tags = operation.tags || [];

      apis.push({
        name: operation.operationId || operation.summary || `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        url: fullUrl,
        description: operation.description || '',
        tags,
        headers,
        body,
        content_type,
      });
    }
  }

  return { format: 'openapi3', title, version, baseUrl, apis };
}

/** 递归解析 JSON Schema 为示例值 */
function resolveSchema(schema: OpenAPIV3.SchemaObject): unknown {
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'object':
      if (!schema.properties) return {};
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema.properties)) {
        obj[k] = resolveSchema(v as OpenAPIV3.SchemaObject);
      }
      return obj;
    case 'array':
      if (!schema.items) return [];
      return [resolveSchema(schema.items as OpenAPIV3.SchemaObject)];
    case 'string': return schema.format === 'date-time' ? '2024-01-01T00:00:00Z' : '';
    case 'number': return 0;
    case 'integer': return 0;
    case 'boolean': return true;
    default: return null;
  }
}

/** 从 Swagger 2.0 解析 */
function parseSwagger2(doc: OpenAPIV2.Document): ParseResult {
  const title = doc.info?.title || 'Untitled';
  const version = doc.info?.version || '1.0.0';
  const basePath = doc.basePath || '';
  const host = doc.host || '';
  const schemes = (doc.schemes as string[]) || ['https'];
  const baseUrl = `${schemes[0]}://${host}${basePath}`;

  const definitions = doc.definitions || {};

  const apis: ParsedApi[] = [];

  for (const [path, pathItem] of Object.entries(doc.paths || {})) {
    const methods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];
    for (const method of methods) {
      const operation = (pathItem as Record<string, unknown>)[method] as { tags?: string[]; description?: string; operationId?: string; summary?: string; parameters?: unknown[]; requestBody?: unknown } | undefined;
      if (!operation) continue;

      const params = (operation.parameters || []) as (OpenAPIV2.Parameter | OpenAPIV2.ReferenceObject)[];
      const headers: Record<string, string> = {};
      let queryParams: Record<string, string> = {};
      const pathParams: Record<string, string> = {};

      for (const p of params) {
        if (('$ref' in p)) {
          const refName = (p as OpenAPIV2.ReferenceObject).$ref.replace('#/parameters/', '');
          const refParam = doc.parameters?.[refName];
          if (refParam && !('$ref' in refParam)) {
            if (refParam.in === 'header') headers[refParam.name] = String(refParam.default ?? '');
            else if (refParam.in === 'query') queryParams[refParam.name] = String(refParam.default ?? '');
            else if (refParam.in === 'path') pathParams[refParam.name] = String(refParam.default ?? '');
          }
          continue;
        }
        const param = p as OpenAPIV2.Parameter;
        if (param.in === 'header') headers[param.name] = String(param.default ?? '');
        else if (param.in === 'query') queryParams[param.name] = String(param.default ?? '');
        else if (param.in === 'path') pathParams[param.name] = String(param.default ?? '');
      }

      let fullUrl = baseUrl + path;
      for (const [k, v] of Object.entries(pathParams)) {
        fullUrl = fullUrl.replace(`{${k}}`, v || `{${k}}`);
      }
      if (Object.keys(queryParams).length > 0) {
        const qs = new URLSearchParams(queryParams).toString();
        fullUrl = fullUrl + '?' + qs;
      }

      let body = '';
      let content_type = '';
      const bodyParam = params.find(p => !('$ref' in p) && (p as OpenAPIV2.Parameter).in === 'body');
      if (bodyParam) {
        content_type = 'application/json';
        const bp = bodyParam as OpenAPIV2.Parameter;
        const refName = (bp as unknown as { schema?: { $ref?: string } }).schema?.$ref;
        if (refName) {
          const defName = refName.replace('#/definitions/', '');
          body = JSON.stringify(resolveSwagger2Schema(definitions[defName]), null, 2);
        }
      }

      const tags = operation.tags || [];

      apis.push({
        name: operation.operationId || operation.summary || `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        url: fullUrl,
        description: operation.description || '',
        tags,
        headers,
        body,
        content_type,
      });
    }
  }

  return { format: 'swagger2', title, version, baseUrl, apis };
}

function resolveSwagger2Schema(def?: OpenAPIV2.SchemaObject): unknown {
  if (!def) return {};
  if (def.example !== undefined) return def.example;
  if (def.enum) return def.enum[0];
  if (def.type === 'object' && def.properties) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(def.properties)) {
      obj[k] = resolveSwagger2Schema(v as OpenAPIV2.SchemaObject);
    }
    return obj;
  }
  if (def.type === 'array' && def.items) {
    return [resolveSwagger2Schema(def.items as OpenAPIV2.SchemaObject)];
  }
  return null;
}

/** 从 Postman Collection v2.1 解析 */
interface PostmanItem {
  name?: string;
  request?: {
    method?: string;
    url?: string | { raw?: string };
    header?: Array<{ key: string; value: string }>;
    body?: { mode?: string; raw?: string };
  };
  item?: PostmanItem[];
}

function parsePostman(doc: Record<string, unknown>): ParseResult {
  const info = doc.info as { name?: string; version?: string } | undefined;
  const title = info?.name || 'Untitled Collection';
  const version = info?.version || '1.0.0';

  const apis: ParsedApi[] = [];

  function processItems(items: PostmanItem[], parentTags: string[] = []): void {
    for (const item of items) {
      if (item.item) {
        // 文件夹，递归处理
        processItems(item.item, [...parentTags, item.name || '']);
      } else if (item.request) {
        const req = item.request;
        const rawUrl = typeof req.url === 'string' ? req.url : req.url?.raw || '';
        const method = (req.method || 'GET').toUpperCase();
        const headers: Record<string, string> = {};
        for (const h of req.header || []) {
          headers[h.key] = h.value;
        }
        let body = '';
        let content_type = '';
        if (req.body?.mode === 'raw' && req.body.raw) {
          body = req.body.raw;
          const ctHeader = (req.header || []).find(h => h.key.toLowerCase() === 'content-type');
          content_type = ctHeader?.value || 'application/json';
        }

        apis.push({
          name: item.name || `${method} ${rawUrl}`,
          method,
          url: rawUrl,
          description: '',
          tags: parentTags,
          headers,
          body,
          content_type,
        });
      }
    }
  }

  const items = (doc.item as PostmanItem[]) || [];
  processItems(items);

  return { format: 'postman', title, version, baseUrl: '', apis };
}

/** 主解析函数 */
export async function parseSpec(raw: string): Promise<ParseResult> {
  const doc = loadDocument(raw);
  const format = detectFormat(doc);

  if (format === 'openapi3') {
    // 验证并解析 $ref
    try {
      const validated = await SwaggerParser.parse(doc as Parameters<typeof SwaggerParser.parse>[0]);
      return parseOpenAPI3(validated as OpenAPIV3.Document);
    } catch {
      return parseOpenAPI3(doc as OpenAPIV3.Document);
    }
  }

  if (format === 'swagger2') {
    return parseSwagger2(doc as OpenAPIV2.Document);
  }

  if (format === 'postman') {
    return parsePostman(doc as Record<string, unknown>);
  }

  throw new Error(`Unsupported format. Please upload an OpenAPI 3.x, Swagger 2.0, or Postman Collection v2.1 file.`);
}

/** 从 URL 解析（带 SSRF 防护） */
export async function parseFromUrl(url: string): Promise<ParseResult> {
  // 1. 协议白名单
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }

  // 2. DNS 解析并校验 IP，阻止 loopback / 私网 / link-local
  const blockedRanges: Array<(ip: number[]) => boolean> = [
    // 0.0.0.0/8
    (ip) => ip[0] === 0,
    // 127.0.0.0/8 loopback
    (ip) => ip[0] === 127,
    // 10.0.0.0/8 private
    (ip) => ip[0] === 10,
    // 172.16.0.0/12 private
    (ip) => ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31,
    // 192.168.0.0/16 private
    (ip) => ip[0] === 192 && ip[1] === 168,
    // 169.254.0.0/16 link-local
    (ip) => ip[0] === 169 && ip[1] === 254,
    // 224.0.0.0/4 multicast
    (ip) => ip[0] >= 224 && ip[0] <= 239,
    // 240.0.0.0/4 reserved (includes 255.255.255.255 broadcast)
    (ip) => ip[0] >= 240,
  ];
  const isBlocked = (ip: string): boolean => {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) return true;
    return blockedRanges.some((fn) => fn(parts));
  };

  // 强制 IPv4 + 解析后立即校验（防止初次 fetch 时 DNS 解析到内网）
  const { promises: dns } = await import('node:dns');
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true, family: 4 });
  } catch {
    throw new Error(`Cannot resolve hostname: ${parsed.hostname}`);
  }
  if (addresses.length === 0) {
    throw new Error(`No DNS records for ${parsed.hostname}`);
  }
  for (const { address } of addresses) {
    if (isBlocked(address)) {
      throw new Error(`URL points to a blocked address: ${address}`);
    }
  }

  // 3. 再次校验（DNS rebinding 防护）：fetch 前对每个候选 IP 都做一次反向解析
  //    简化处理：fetch 绑定到第一个已校验 IP，通过自定义 lookup 实现
  const safeAddress = addresses[0].address;

  // 4. 拉取（限制响应体大小为 5MB 防止内存耗尽）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(parsed.toString(), {
      signal: controller.signal,
      // @ts-expect-error -- Node 18+ fetch 支持 dispatcher / lookup
      lookup: (_host: string, _opts: unknown, cb: (err: unknown, addr: string, family: number) => void) => {
        cb(null, safeAddress, 4);
      },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`Failed to fetch URL: ${response.status}`);

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > 5 * 1024 * 1024) {
    throw new Error('Response too large (>5MB)');
  }
  const raw = await response.text();
  if (raw.length > 5 * 1024 * 1024) {
    throw new Error('Response too large (>5MB)');
  }
  return parseSpec(raw);
}
