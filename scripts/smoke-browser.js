// Isolated Chromium profile; all MasOnline responses are fixtures, no real cart is used.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const core = require("../src/core.js");

(async () => {
  const extension = path.resolve(__dirname, "..");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  try {
    const errors = [];
    const requests = [];
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.protocol === "chrome-extension:") return route.continue();
      if (url.origin !== "https://www.masonline.com.ar") return route.abort();
      if (url.pathname.includes("graphql")) {
        requests.push(url.href);
        const variables = core.variablesFrom(url.href, "");
        return route.fulfill({ json: { data: { itemsWithSimulation: variables.items.map(item => ({
          ...item, sellers: item.sellers.map(seller => ({ ...seller, commertialOffer: { Price: 100, AvailableQuantity: 4 } }))
        })) } } });
      }
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Prueba aislada MasOnline Turbo</title><h1>Catálogo de prueba</h1>" });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto("https://www.masonline.com.ar/");
    await page.waitForFunction(() => window.__MASONLINE_TURBO_ACTIVE__);
    const run = () => page.evaluate(async () => {
      // React/Apollo creates a new AbortSignal when a card remounts after scrolling.
      window.__testControllers?.forEach(controller => controller.abort());
      window.__testControllers = [];
      document.querySelectorAll("button[data-fixture-sku]").forEach(button => button.remove());
      const urls = Array.from({ length: 36 }, (_, i) => {
        const url = new URL("/_v/segment/graphql/v1", location.origin);
        url.searchParams.set("operationName", "itemsWithSimulation");
        url.searchParams.set("variables", "{}");
        url.searchParams.set("extensions", JSON.stringify({ persistedQuery: { sha256Hash: "fixture" }, variables: btoa(JSON.stringify({ items: [{ itemId: String(i), sellers: [{ sellerId: "1" }] }] })) }));
        return url.href;
      });
      return Promise.all(urls.map(async url => {
        const controller = new AbortController();
        window.__testControllers.push(controller);
        const result = await (await fetch(new Request(url, { signal: controller.signal }))).json();
        const sku = result.data.itemsWithSimulation[0].itemId;
        const button = document.createElement("button");
        button.dataset.fixtureSku = sku;
        button.textContent = "+";
        document.body.append(button);
        return sku;
      }));
    });
    assert.equal((await run()).length, 36);
    assert.equal(requests.length, 1);
    await run();
    assert.equal(requests.length, 1);
    assert.equal(await page.locator("button[data-fixture-sku]").count(), 36);
    const tabId = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: "https://www.masonline.com.ar/*" });
      return tabs[0].id;
    });
    // A second tab must not overwrite metrics from the first tab.
    const second = await context.newPage();
    await second.goto("https://www.masonline.com.ar/second");
    await worker.evaluate(async tabId => {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        const stored = await chrome.storage.session.get(`turboMetrics:${tabId}`);
        if (stored[`turboMetrics:${tabId}`]?.cacheHits === 36) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error("No se recibieron métricas por el puente del service worker");
    }, tabId);
    const popup = await context.newPage();
    await page.bringToFront();
    // Load the popup document in a background tab while the catalogue remains active.
    await popup.goto(`chrome-extension://${id}/src/popup.html`);
    await popup.waitForFunction(() => document.querySelector("#status").textContent === "Activo");
    assert.equal(await popup.locator("#cacheHits").textContent(), "36");
    assert.equal(await popup.locator("#network").textContent(), "1");
    await popup.locator("#clear").click();
    await popup.waitForFunction(() => document.querySelector("#cacheHits").textContent === "0");
    assert.deepEqual(errors, []);
    console.log("Chromium: 36 tarjetas con Request/AbortSignal → 1 consulta; al remontarlas reaparecen los 36 botones + sin red adicional. Métricas por pestaña y popup verificados.");
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
