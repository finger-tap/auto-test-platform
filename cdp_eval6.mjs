import WebSocket from 'ws';

const WS_URL = 'ws://127.0.0.1:18800/devtools/page/0E3AB71FA0D8319CE71BDFAC007E7BD9';
const ws = new WebSocket(WS_URL);
let msgId = 1;

ws.on('open', () => {
  // Use callFunctionOn to trigger the actual event handler
  const expr = `JSON.stringify({
    // Try to find and call React's synthetic event
    result: (() => {
      const token = document.querySelector('.var-token');
      if (!token) return 'no token';
      // Get the React fiber for this element
      const key = Object.keys(token).find(k => k.startsWith('__reactFiber'));
      const fiber = token[key];
      if (fiber) {
        // Try to call the onMouseEnter handler
        // React stores event handlers in memoizedProps and updates
        const handler = fiber.memoizedProps?.onMouseEnter || fiber.pendingProps?.onMouseEnter;
        if (handler) {
          try {
            const mockEvent = { target: token, currentTarget: token, bubbles: true, type: 'mouseenter', stopPropagation: () => {}, preventDefault: () => {} };
            handler(mockEvent);
            return 'handler called, tooltip: ' + (document.querySelector('.var-tooltip')?.textContent || 'not found');
          } catch(e) { return 'error: ' + e.message; }
        }
        return 'no handler found on fiber, keys: ' + Object.keys(fiber).filter(k=>k.includes('react')||k.includes('handler')||k.includes('mouse')).join(',');
      }
      return 'no fiber found';
    })(),
    tokenKeys: (() => {
      const token = document.querySelector('.var-token');
      return Object.keys(token).filter(k => k.startsWith('__react')).join(', ');
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
