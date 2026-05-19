import type { ApiRow } from '../db/apis.js';

export interface ExportOptions {
  title?: string;
  version?: string;
  description?: string;
  baseUrl?: string;
  includeScripts?: boolean;
}

/** 将单个 API 项转为 OpenAPI 3.0 PathItem */
function apiToPathItem(api: ApiRow, baseUrl: string): Record<string, unknown> {
  const method = api.method.toLowerCase();
  const url = api.url || '';
  // 去掉 baseUrl 前缀得到 path
  let path = url;
  if (baseUrl && url.startsWith(baseUrl)) {
    path = url.slice(baseUrl.length);
  }
  // 去掉查询参数
  path = path.split('?')[0];

  // 解析 headers
  const headers: Record<string, unknown> = {};
  let parsedHeaders: Array<{ key: string; value: string; required?: boolean }> = [];
  try {
    parsedHeaders = JSON.parse(api.headers || '[]');
  } catch {
    // ignore
  }
  for (const h of parsedHeaders) {
    if (h.key) {
      headers[h.key] = { type: 'string', default: h.value };
    }
  }

  const operation: Record<string, unknown> = {
    summary: api.name,
    description: api.description || '',
    tags: api.tags ? api.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
  };

  if (Object.keys(headers).length > 0) {
    operation.parameters = Object.entries(headers).map(([key, val]) => ({
      name: key,
      in: 'header',
      required: false,
      schema: { type: 'string', default: (val as { default?: string }).default },
    }));
  }

  // 请求体
  if (api.body && ['POST', 'PUT', 'PATCH'].includes(api.method)) {
    const contentType = api.content_type || 'application/json';
    operation.requestBody = {
      required: true,
      content: {
        [contentType]: {
          schema: {
            type: 'object',
            example: (() => {
              try { return JSON.parse(api.body || '{}'); } catch { return {}; }
            })(),
          },
        },
      },
    };
  }

  // 响应
  operation.responses = {
    '200': {
      description: 'Successful response',
    },
    '400': { description: 'Bad Request' },
    '500': { description: 'Server Error' },
  };

  return { [path]: { [method]: operation } };
}

/** 将多个 API 导出为 OpenAPI 3.0 Document */
export function exportToOpenAPI3(apis: ApiRow[], opts: ExportOptions = {}): Record<string, unknown> {
  const { title = 'API Export', version = '1.0.0', description = '', baseUrl = 'https://api.example.com' } = opts;

  const paths: Record<string, Record<string, unknown>> = {};
  for (const api of apis) {
    const pathItem = apiToPathItem(api, baseUrl);
    for (const [p, methods] of Object.entries(pathItem)) {
      if (!paths[p]) paths[p] = {};
      Object.assign(paths[p], methods);
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title,
      version,
      description,
    },
    servers: [{ url: baseUrl }],
    paths,
  };
}

/** 生成 Postman Collection v2.1 */
export function exportToPostman(apis: ApiRow[], opts: ExportOptions = {}): Record<string, unknown> {
  const { title = 'API Export', version = '1.0.0' } = opts;

  const items = apis.map(api => {
    const url = api.url || '';
    const headers: Array<{ key: string; value: string; type: string }> = [];
    let parsedHeaders: Array<{ key: string; value: string }> = [];
    try {
      parsedHeaders = JSON.parse(api.headers || '[]');
    } catch { /* ignore */ }
    for (const h of parsedHeaders) {
      if (h.key) headers.push({ key: h.key, value: h.value, type: 'text' });
    }

    let body: Record<string, unknown> | null = null;
    if (api.body && ['POST', 'PUT', 'PATCH'].includes(api.method)) {
      body = { mode: 'raw', raw: api.body || '', options: { raw: { language: 'json' } } };
    }

    return {
      name: api.name,
      request: {
        method: api.method,
        header: headers,
        url: {
          raw: url,
          protocol: url.startsWith('https') ? 'https' : 'http',
          query: url.includes('?') ? url.split('?')[1].split('&').map(q => {
            const [k, v] = q.split('=');
            return { key: k, value: v || '', type: 'text' };
          }) : [],
        },
        body,
      },
    };
  });

  return {
    info: {
      name: title,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      version,
    },
    item: items,
  };
}
