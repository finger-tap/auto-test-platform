/**
 * WebSocket Executor — single round-trip:
 *   connect → send one message → wait for response → close
 * Supports variable substitution and simple assertion validation.
 */

import WebSocket from 'ws';
import * as https from 'node:https';
import { evalBuiltin } from './builtins.js';
import { evaluateAssertions } from './api-executor.js';
import type { AssertionRule } from '../db/apis.js';

export interface WsExecutionResult {
  connected: boolean;
  error_message?: string;
  duration_ms: number;
  sent?: string;
  received?: string;
  assertion_results?: Array<{ rule: AssertionRule; passed: boolean; actual: string }>;
}

function substitute(text: string, vars: Record<string, string>): string {
  return evalBuiltin(text, vars);
}

export async function executeWsSession(
  url: string,
  sendMsg: string,
  assertionRules: AssertionRule[] = [],
  sslCert?: string,
  sslKey?: string,
  timeout: number = 30000,
  vars: Record<string, string> = {}
): Promise<WsExecutionResult> {
  const start = Date.now();
  const substituted = substitute(sendMsg, vars);

  return new Promise((resolve) => {
    let ws: WebSocket | null = null;

    const agentOptions = (sslCert || sslKey)
      ? { cert: sslCert, key: sslKey }
      : undefined;

    const connectTimeout = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
        resolve({ connected: false, error_message: `Connection timeout (${timeout}ms)`, duration_ms: Date.now() - start });
      }
    }, timeout);

    const wsOptions: Record<string, unknown> = {};
    if (agentOptions) {
      wsOptions.agent = new https.Agent(agentOptions);
    }

    try {
      ws = new WebSocket(url, wsOptions as WebSocket.ClientOptions);
    } catch (err) {
      clearTimeout(connectTimeout);
      resolve({ connected: false, error_message: err instanceof Error ? err.message : 'Unknown error', duration_ms: Date.now() - start });
      return;
    }

    ws.on('open', () => {
      clearTimeout(connectTimeout);
      if (ws) ws.send(substituted);
    });

    ws.on('message', (data: unknown) => {
      const raw = data instanceof Buffer ? data : Buffer.from(String(data));
      const received = raw.toString('utf8');

      // Evaluate assertions against the received message
      let assertionResults: WsExecutionResult['assertion_results'] = undefined;
      if (assertionRules.length > 0) {
        const pseudoStatus = 101; // Switching Protocols — indicates WS upgrade succeeded
        const respHeaders: Record<string, string> = { 'sec-websocket-protocol': 'ws-received' };
        const { results } = evaluateAssertions(assertionRules, pseudoStatus, respHeaders, received);
        assertionResults = results;
      }

      if (ws) ws.close();
      resolve({ connected: true, duration_ms: Date.now() - start, sent: substituted, received, assertion_results: assertionResults });
    });

    ws.on('error', (err) => {
      clearTimeout(connectTimeout);
      resolve({ connected: false, error_message: err.message, duration_ms: Date.now() - start });
    });

    ws.on('close', () => {
      clearTimeout(connectTimeout);
      // If we haven't resolved yet, no message was received
      resolve({
        connected: ws !== null,
        duration_ms: Date.now() - start,
        sent: substituted,
        received: '',
        assertion_results: assertionRules.length > 0 ? [] : undefined,
      });
    });
  });
}