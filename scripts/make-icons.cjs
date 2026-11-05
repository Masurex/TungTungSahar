// Renders PNG app icons from www/icons/icon.svg using the preinstalled Chromium.
// Usage: node scripts/make-icons.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const dir = path.join(__dirname, '..', 'www', 'icons');
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const jobs = [
    ['icon-192.png', 192, false],
    ['icon-512.png', 512, false],
    ['icon-maskable-512.png', 512, true],
  ];
  for (const [name, size, maskable] of jobs) {
    await page.setViewportSize({ width: size, height: size });
    const inner = maskable
      ? `<div style="width:100%;height:100%;background:#121014;display:grid;place-items:center"><div style="width:80%;height:80%">${svg.replace('rx="112"', 'rx="0"')}</div></div>`
      : svg;
    await page.setContent(`<html><body style="margin:0;background:transparent">
      <div style="width:${size}px;height:${size}px">${inner}</div>
      <style>svg{width:100%;height:100%;display:block}</style></body></html>`);
    await page.screenshot({ path: path.join(dir, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  await browser.close();
  console.log('icons written');
})();
