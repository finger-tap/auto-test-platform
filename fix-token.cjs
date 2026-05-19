const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: false, 
    userDataDir: '/Users/dinghao/.youclaw/browser-profiles/youclaw'
  });
  
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  
  await page.goto('http://localhost:3000/scenario-set');
  await page.evaluate(() => {
    localStorage.setItem('token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImFjY291bnQiOiJwb255IiwiaWF0IjoxNzc5MDEwNjE1LCJleHAiOjE3ODE2MDI2MTV9.Mwb-qAFa4EzrFBtobfXO8EQy6a6BG1VBnksH96TV8ag');
    localStorage.setItem('userInfo', JSON.stringify({userId:1,account:'pony',nickname:'pony'}));
  });
  await page.reload();
  await page.waitForTimeout(3000);
  const text = await page.textContent('body');
  console.log(text.substring(0, 1000));
  await browser.close();
})().catch(e => console.error(e.message));