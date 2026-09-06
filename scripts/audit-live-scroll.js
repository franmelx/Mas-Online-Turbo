// Read-only public catalogue audit in an isolated browser profile. Never clicks +/cart.
const { chromium } = require("playwright");
const path = require("node:path");

(async () => {
  const extension = path.resolve(__dirname, "..");
  const enabled = !process.argv.includes("--without-extension");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium", headless: true, viewport: { width: 1440, height: 1000 },
    args: enabled ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] : []
  });
  try {
    const page = await context.newPage();
    const counts = {};
    const summary = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.origin !== "https://www.masonline.com.ar") return;
      const op = url.searchParams.get("operationName");
      if (op) counts[op] = (counts[op] || 0) + 1;
    });
    await page.goto("https://www.masonline.com.ar/cif?_q=cif&map=ft", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(10000);
    const snapshot = async stage => {
      const state = await page.evaluate(() => {
        const cards = [...document.querySelectorAll(".vtex-product-summary-2-x-container")];
        return {
          cards: cards.length,
          visible: cards.filter(card => { const r = card.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).map(card => ({
            name: card.querySelector('[class*="productBrand"]')?.textContent?.trim(),
            plus: [...card.querySelectorAll("button")].some(button => button.textContent.trim() === "+" && button.getClientRects().length > 0)
          }))
        };
      });
      summary.push({ stage, ...state, requests: { ...counts } });
    };
    await snapshot("initial");
    const first = page.locator(".vtex-product-summary-2-x-container").first();
    await first.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);
    await snapshot("first-visible");
    const more = page.getByText("Mostrar más", { exact: true }).first();
    if (await more.count()) {
      await more.scrollIntoViewIfNeeded();
      await more.click();
      await page.waitForTimeout(4000);
    }
    await page.evaluate(() => window.scrollBy(0, 1800));
    await page.waitForTimeout(2000);
    const beforeReturn = { ...counts };
    await first.scrollIntoViewIfNeeded();
    const start = Date.now();
    const firstPlus = first.getByRole("button", { name: "+", exact: true });
    let visible = true;
    try { await firstPlus.waitFor({ state: "visible", timeout: 15000 }); } catch (_) { visible = false; }
    const elapsed = Date.now() - start;
    await snapshot("returned");
    console.log(JSON.stringify({ extension: enabled, firstPlusVisible: visible, returnWaitMs: elapsed,
      repeatedSimulationRequests: (counts.itemsWithSimulation || 0) - (beforeReturn.itemsWithSimulation || 0), stages: summary }, null, 2));
  } finally { await context.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
