import WebSocket from 'ws';

const WS_URL = 'ws://127.0.0.1:18800/devtools/page/0E3AB71FA0D8319CE71BDFAC007E7BD9';

const ws = new WebSocket(WS_URL);
let msgId = 1;

ws.on('open', () => {
  const expr = `JSON.stringify({
    activeEnvId: localStorage.getItem('active_env_id'),
    // Find all .var-token elements and check their text
    tokens: Array.from(document.querySelectorAll('.var-token')).map(e => e.textContent),
    preview: document.querySelector('.ad-url-preview')?.textContent,
    // Check tooltip on hover
    tipCheck: (() => {
      const t = document.querySelector('.var-token');
      if (t) t.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      return document.querySelector('.var-tooltip')?.textContent || 'NO TOOLTIP';
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
