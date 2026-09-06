const { chromium } = require("playwright");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const source = pathToFileURL(path.resolve(__dirname, "../store-assets/render.html")).href;
  const outputs = [
    [1280, 800, "screenshot-1280x800.png"],
    [440, 280, "promo-small-440x280.png"],
    [1400, 560, "promo-large-1400x560.png"]
  ];
  for (const [width, height, filename] of outputs) {
    await page.setViewportSize({ width, height });
    await page.goto(source);
    await page.screenshot({ path: path.resolve(__dirname, "../store-assets", filename) });
  }
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
