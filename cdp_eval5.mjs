import WebSocket from 'ws';

const WS_URL = 'ws://127.0.0.1:18800/devtools/page/0E3AB71FA0D8319CE71BDFAC007E7BD9';
const ws = new WebSocket(WS_URL);
let msgId = 1;

ws.on('open', () => {
  // First, check the actual network response data from React's internal state
  // Find all window keys that might hold React fiber data
  const expr = `JSON.stringify({
    // Check if we can find environment data via React DevTools or similar
    allDataKeys: Object.keys(window).filter(k => k.length < 10),
    // Check localStorage for env cache
    lsKeys: Object.keys(localStorage),
    lsValues: Object.entries(localStorage).reduce((acc, [k, v]) => {
      try { acc[k] = v.slice(0, 100); } catch { acc[k] = 'error'; }
      return acc;
    }, {}),
    // Check if the var-token has any data attribute  
    tokenData: (() => {
      const t = document.querySelector('.var-token');
      if (!t) return null;
      // Get all attributes
      let attrs = {};
      for (let i = 0; i < t.attributes.length; i++) {
        attrs[t.attributes[i].name] = t.attributes[i].value;
      }
      return attrs;
    })(),
    // Check parent element
    parentInfo: (() => {
      const t = document.querySelector('.var-token');
      if (!t) return null;
      const p = t.parentElement;
      return { tag: p?.tagName, class: p?.className, id: p?.id, dataAttrs: Object.fromEntries(Object.entries(p?.dataset || {}).map(([k,v]) => [k, String(v).slice(0, 50)])) };
    })()
  })`;
  ws.send(JSON.stringify({ id: msgId++, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id) {
    console.log(JSON.stringify(JSON.parse(msg.result?.result?.value || '{}'), null, 2));
    ws.close();
    process.exit(0);
  }
});

ws.on('error', e => { console.log('WS error:', e.message); process.exit(1); });
setTimeout(() => { ws.close(); process.exit(1); }, 5000);
