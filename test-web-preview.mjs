import { chromium } from '@playwright/test';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  const response = await page.goto('http://127.0.0.1:3000');
  
  // Create a new project via API or just run through the flow!
  // Easier: we can just serve the generated index.html directly from a temp dir and open it in playwright!
  
  await browser.close();
}
main();
