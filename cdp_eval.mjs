import WebSocket from 'ws';

const WS_URL = 'ws://127.0.0.1:18800/devtools/page/0E3AB71FA0D8319CE71BDFAC007E7BD9';

const ws = new WebSocket(WS_URL);
let msgId = 1;

ws.on('open', () => {
  const expr = `JSON.stringify({
    varTokenCount: document.querySelectorAll('.var-token').length,
    previewText: document.querySelector('.ad-url-preview')?.textContent || 'NOT FOUND',
    previewHTML: document.querySelector('.ad-url-preview')?.innerHTML?.slice(0,100) || 'NOT FOUND',
    activeEnvId: localStorage.getItem('active_env_id'),
    activeEnvVarCount: (window.__ENV__?.activeEnv?.variables || []).length,
    bodyEnvVar: JSON.stringify((window.__ENV__?.activeEnv?.variables || []).map(v=>({k:v.key,v:v.value}))).slice(0,300)
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
