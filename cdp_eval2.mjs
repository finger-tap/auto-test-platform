import WebSocket from 'ws';

const WS_URL = 'ws://127.0.0.1:18800/devtools/page/0E3AB71FA0D8319CE71BDFAC007E7BD9';

const ws = new WebSocket(WS_URL);
let msgId = 1;

ws.on('open', () => {
  const expr = `JSON.stringify({
    envVarRaw: JSON.stringify(window.__ENV__?.activeEnv?.variables).slice(0,200),
    envVarKeys: (window.__ENV__?.activeEnv?.variables || []).map(v=>v.key),
    activeEnvName: window.__ENV__?.activeEnv?.name,
    activeEnvId: window.__ENV__?.activeEnv?.id,
    localStorageEnvId: localStorage.getItem('active_env_id'),
    // Check if activeEnv has raw string variables
    hasRawVariables: window.__ENV__?.activeEnv?.variables === null,
    // Try to trigger showTip manually
    tipContent: (() => {
      const tokens = document.querySelectorAll('.var-token');
      if (!tokens.length) return 'no tokens';
      // Simulate hover
      tokens[0].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      return document.querySelector('.var-tooltip')?.textContent || 'tooltip not found after mouseenter';
    })()
  })`;
  ws.send(JSON.stringify({ id: msgId++, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id) {
    console.log('Result:', msg.result?.result?.value || JSON.stringify(msg.result));
    ws.close();
    process.exit(0);
  }
});

ws.on('error', e => { console.log('WS error:', e.message); process.exit(1); });
setTimeout(() => { console.log('timeout'); ws.close(); process.exit(1); }, 5000);
