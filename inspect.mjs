import { chromium } from 'playwright';

const browser = await chromium.connect('http://127.0.0.1:18800');
const pages = await browser.pages();
const target = pages.find(p => p.url().includes('api-case/2'));

if (!target) { console.log('No target page found'); process.exit(1); }

await target.goto('http://localhost:3000/api-test/api-case/2');
await target.waitForTimeout(2000);

// Click on the "主体动作" tab
const tabs = await target.locator('button:has-text("主体动作")').all();
if (tabs.length) await tabs[0].click();
await target.waitForTimeout(1000);

// Check DOM state
const info = await target.evaluate(() => {
  const tokens = document.querySelectorAll('.var-token');
  const preview = document.querySelector('.ad-url-preview');
  const tooltip = document.querySelector('.var-tooltip');
  return {
    varTokenCount: tokens.length,
    varTokens: Array.from(tokens).map(t => t.textContent),
    previewExists: !!preview,
    previewText: preview?.textContent,
    previewHTML: preview?.innerHTML?.slice(0, 200),
    tooltipExists: !!tooltip,
    tooltipText: tooltip?.textContent,
  };
});

console.log('DOM State:', JSON.stringify(info, null, 2));

await browser.close();
