import WebSocket from 'ws';

const WS_URL = 'ws://127.0.0.1:18800/devtools/page/0E3AB71FA0D8319CE71BDFAC007E7BD9';

const ws = new WebSocket(WS_URL);
let msgId = 1;

ws.on('open', () => {
  const expr = `JSON.stringify({
    localStorage_env_id: localStorage.getItem('active_env_id'),
    // Check the environments array length in the context (via window)
    windowKeys: Object.keys(window).filter(k => k.includes('ENV') || k.includes('env') || k.includes('Env')),
    // Find which React context has the environment data
    // Check all .var-token elements
    tokenInfo: Array.from(document.querySelectorAll('.var-token')).map(t => ({
      text: t.textContent,
      outerHTML: t.outerHTML.slice(0, 100),
      dataKey: t.dataset.key,
      title: t.title
    })),
    // Check for var-hover-wrap
    hoverWrap: document.querySelector('.var-hover-wrap')?.outerHTML?.slice(0, 200) || 'NOT FOUND'
  })`;
  ws.send(JSON.stringify({ id: msgId++, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id) {
    console.log('Result:', JSON.stringify(JSON.parse(msg.result?.result?.value || '{}'), null, 2));
    ws.close();
    process.exit(0);
  }
});

ws.on('error', e => { console.log('WS error:', e.message); process.exit(1); });
setTimeout(() => { console.log('timeout'); ws.close(); process.exit(1); }, 5000);
