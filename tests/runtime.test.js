const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../src/core.js");
const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const ORIGIN = "https://www.masonline.com.ar";

function query(operation, variables = {}, extras = {}) {
  const url = new URL(`${ORIGIN}/_v/segment/graphql/v1`);
  url.searchParams.set("operationName", operation);
  url.searchParams.set("extensions", JSON.stringify({ persistedQuery: { sha256Hash: "fixture" }, variables: core.encodeBase64Json(variables) }));
  for (const [key, value] of Object.entries(extras)) url.searchParams.set(key, value);
  return url.href;
}
const item = (id, seller = "1") => ({ itemId: String(id), sellers: [{ sellerId: seller }] });
const simulation = (items, other = {}) => query("itemsWithSimulation", { ...other, items });
const json = (payload, init = {}) => new Response(JSON.stringify(payload), { ...init, headers: { "content-type": "application/json", ...init.headers } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)); };

function harness(handler = () => json({ data: { ok: true } })) {
  const window = new EventTarget();
  let now = 100000;
  let timerId = 0;
  const timers = new Map();
  const calls = [];
  window.__MASONLINE_TURBO_CORE__ = core;
  window.fetch = (input, init) => {
    calls.push({ input, init });
    return Promise.resolve().then(() => handler(input, init, calls.length));
  };
  window.setTimeout = (callback, ms) => { const id = ++timerId; timers.set(id, { callback, at: now + ms }); return id; };
  window.clearTimeout = id => timers.delete(id);
  const document = { cookie: "" };
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(source, { window, document, location: { href: ORIGIN }, Date: Clock,
    Request, Response, Headers, URL, TextEncoder, TextDecoder, Uint8Array, CustomEvent, AbortController, ReadableStream, DOMException });
  return {
    window, document, calls, fetch: window.fetch,
    settings: detail => window.dispatchEvent(new CustomEvent("masonline-turbo:settings", { detail })),
    clear: () => window.dispatchEvent(new CustomEvent("masonline-turbo:clear")),
    tick: async ms => {
      await settle(); now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
      await settle();
    }
  };
}

test("consultas equivalentes concurrentes usan una sola red y luego caché", async () => {
  const h = harness();
  const a = query("ProductQuery", { sku: "1", region: "AR" }, { b: "2", a: "1" });
  const b = query("ProductQuery", { region: "AR", sku: "1" }, { a: "1", b: "2" });
  const results = await Promise.all([h.fetch(a), h.fetch(b)]);
  assert.deepEqual(await results[0].json(), await results[1].json());
  await h.fetch(b);
  assert.equal(h.calls.length, 1);
});

test("headers y credenciales distintos no comparten caché ni dedupe", async () => {
  const h = harness();
  const url = query("ProductQuery");
  await Promise.all([h.fetch(url, { headers: { "x-region": "A" } }), h.fetch(url, { headers: { "x-region": "B" } }), h.fetch(url, { credentials: "omit" })]);
  assert.equal(h.calls.length, 3);
});

for (const [name, make] of [
  ["HTTP 500", () => json({ error: "fail" }, { status: 500 })],
  ["GraphQL con errores", () => json({ data: { product: null }, errors: [{ message: "fail" }] })],
  ["no-store", () => json({ data: {} }, { headers: { "cache-control": "no-store" } })],
  ["JSON inválido", () => new Response("{broken", { headers: { "content-type": "application/json" } })],
  ["204", () => new Response(null, { status: 204 })]
]) test(`${name} se devuelve sin cachear ni reintentar`, async () => {
  const h = harness(make);
  const a = await h.fetch(query("ProductQuery"));
  const b = await h.fetch(query("ProductQuery"));
  assert.equal(a.status, b.status);
  assert.equal(h.calls.length, 2);
});

test("fallo de red conserva el rechazo para todos los consumidores sin repetirlo", async () => {
  const h = harness(() => { throw new TypeError("offline"); });
  const results = await Promise.allSettled([h.fetch(query("ProductQuery")), h.fetch(query("ProductQuery"))]);
  assert.ok(results.every(result => result.status === "rejected"));
  assert.equal(h.calls.length, 1);
});

test("respuestas de más de 2 MiB no se pierden ni fuerzan una segunda petición", async () => {
  const payload = { value: "x".repeat(2 * 1024 * 1024 + 20) };
  const h = harness(() => json(payload));
  const response = await h.fetch(query("ProductQuery"));
  assert.deepEqual(await response.json(), payload);
  assert.equal(h.calls.length, 1);
});

test("caché global desaloja respuestas al superar su presupuesto", async () => {
  const h = harness(() => json({ value: "x".repeat(1500000) }));
  for (let i = 0; i < 13; i++) await h.fetch(query("ProductQuery", { sku: i }));
  await h.fetch(query("ProductQuery", { sku: 0 }));
  assert.equal(h.calls.length, 14);
  await h.fetch(query("ProductQuery", { sku: 12 }));
  assert.equal(h.calls.length, 14);
});

test("una respuesta pendiente no repuebla caché después de vaciarla", async () => {
  const old = deferred();
  const h = harness((_input, _init, count) => count === 1 ? old.promise : json({ data: { fresh: true } }));
  const pending = h.fetch(query("ProductQuery"));
  await settle(); h.clear();
  old.resolve(json({ data: { stale: true } }));
  await pending;
  assert.deepEqual(await (await h.fetch(query("ProductQuery"))).json(), { data: { fresh: true } });
  assert.equal(h.calls.length, 2);
});

test("cambio de cookie regional base64 separa incluso respuestas todavía en vuelo", async () => {
  const old = deferred();
  const h = harness((_input, _init, count) => count === 1 ? old.promise : json({ data: { region: "B" } }));
  h.document.cookie = `vtex_segment=${core.encodeBase64Json({ regionId: "A" })}`;
  const pending = h.fetch(query("ProductQuery"));
  await settle();
  h.document.cookie = `vtex_segment=${core.encodeBase64Json({ regionId: "B" })}`;
  old.resolve(json({ data: { region: "A" } }));
  await pending;
  assert.equal((await (await h.fetch(query("ProductQuery"))).json()).data.region, "B");
  assert.equal(h.calls.length, 2);
});

test("mutación lenta mantiene bypass hasta finalizar y no cachea lecturas intermedias", async () => {
  const write = deferred();
  const h = harness((input) => String(input).includes("orderForm") ? write.promise : json({ data: {} }));
  const url = query("ProductQuery");
  await h.fetch(url);
  const pendingWrite = h.fetch(`${ORIGIN}/api/checkout/pub/orderForm/test/items`, { method: "POST", body: "{}" });
  await h.tick(10000);
  await h.fetch(url); await h.fetch(url);
  assert.equal(h.calls.length, 4);
  write.resolve(json({ orderFormId: "test" })); await pendingWrite;
  await h.tick(5001);
  await h.fetch(url); await h.fetch(url);
  assert.equal(h.calls.length, 5);
});

test("solicitudes cancelables conservan señales independientes y no reintentan abortos", async () => {
  const result = deferred();
  const h = harness((_input, init) => new Promise((resolve, reject) => {
    if (init?.signal?.aborted) { reject(init.signal.reason); return; }
    init?.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    result.promise.then(resolve, reject);
  }));
  const controller = new AbortController();
  const first = h.fetch(query("ProductQuery"), { signal: controller.signal });
  const rejected = assert.rejects(first, { name: "AbortError" });
  const second = h.fetch(query("ProductQuery"));
  await settle(); controller.abort();
  await rejected;
  result.resolve(json({ data: { ok: true } }));
  assert.equal((await (await second).json()).data.ok, true);
  assert.equal(h.calls.length, 1);
});

test("Request conserva headers y credenciales originales sin reconstrucción", async () => {
  const h = harness();
  const request = new Request(query("ProductQuery"), { headers: { "x-test": "preserved" }, credentials: "include" });
  await h.fetch(request);
  assert.equal(h.calls[0].input, request);
});

test("sesiones y no-store nunca se recuperan de caché", async () => {
  const h = harness();
  for (let i = 0; i < 2; i++) await h.fetch(`${ORIGIN}/api/sessions`);
  for (let i = 0; i < 2; i++) await h.fetch(query("ProductQuery"), { cache: "no-store" });
  assert.equal(h.calls.length, 4);
});

function simulate(input) {
  const variables = core.variablesFrom(String(input), "");
  return json({ data: { itemsWithSimulation: variables.items.map(requested => ({
    ...requested, sellers: requested.sellers.map(seller => ({ ...seller, commertialOffer: { Price: 100, AvailableQuantity: 4 } }))
  })) } });
}

test("36 tarjetas producen un lote y el scroll repetido no agrega llamadas", async () => {
  const h = harness(simulate);
  const urls = Array.from({ length: 36 }, (_, i) => simulation([item(i)]));
  const pending = Promise.all(urls.map(url => h.fetch(url)));
  await h.tick(25);
  const responses = await pending;
  assert.equal(h.calls.length, 1);
  for (let i = 0; i < responses.length; i++) assert.equal((await responses[i].json()).data.itemsWithSimulation[0].itemId, String(i));
  await Promise.all(urls.map(url => h.fetch(url)));
  assert.equal(h.calls.length, 1);
});

test("duplicados mientras un lote está en red se unen a la solicitud pendiente", async () => {
  const result = deferred();
  const h = harness(() => result.promise);
  const urls = [simulation([item(1)]), simulation([item(2)])];
  const initial = urls.map(url => h.fetch(url));
  await h.tick(25);
  const repeated = h.fetch(urls[0]);
  await settle();
  result.resolve(simulate(h.calls[0].input));
  await Promise.all([...initial, repeated]);
  assert.equal(h.calls.length, 1);
});

test("lotes grandes se dividen y preservan variables no relacionadas con items", async () => {
  const h = harness(simulate);
  const pending = Promise.all(Array.from({ length: 85 }, (_, i) => h.fetch(simulation([item(i)], { region: "AR", tradePolicy: "2" }))));
  await h.tick(25); await pending;
  assert.equal(h.calls.length, 3);
  for (const call of h.calls) {
    const variables = core.variablesFrom(call.input, "");
    assert.ok(variables.items.length <= 40);
    assert.equal(variables.region, "AR");
    assert.equal(variables.tradePolicy, "2");
  }
});

test("mismo SKU con vendedores diferentes no comparte lotes ni resultados", async () => {
  const h = harness(simulate);
  const pending = Promise.all([h.fetch(simulation([item(1, "A")])), h.fetch(simulation([item(1, "B")]))]);
  await h.tick(25);
  const responses = await pending;
  assert.equal((await responses[0].json()).data.itemsWithSimulation[0].sellers[0].sellerId, "A");
  assert.equal((await responses[1].json()).data.itemsWithSimulation[0].sellers[0].sellerId, "B");
  assert.equal(h.calls.length, 2);
});

test("contexto adicional y headers separan los lotes", async () => {
  const h = harness(simulate);
  const pending = Promise.all([
    h.fetch(simulation([item(1)], { region: "A" })),
    h.fetch(simulation([item(2)], { region: "B" })),
    h.fetch(simulation([item(3)], { region: "A" }), { headers: { "x-seller": "B" } })
  ]);
  await h.tick(25); await pending;
  assert.equal(h.calls.length, 3);
});

test("lote incompleto vuelve a la red para todos sin resolver respuestas parciales", async () => {
  const h = harness(input => {
    const variables = core.variablesFrom(input, "");
    if (variables.items.length > 1) return json({ data: { itemsWithSimulation: [item(1)] } });
    return simulate(input);
  });
  const pending = Promise.all([h.fetch(simulation([item(1)])), h.fetch(simulation([item(2)]))]);
  await h.tick(25);
  const responses = await pending;
  assert.ok((await responses[0].json()).data.itemsWithSimulation[0].sellers[0].commertialOffer);
  assert.equal((await responses[1].json()).data.itemsWithSimulation[0].itemId, "2");
  assert.equal(h.calls.length, 3);
});

test("pausar resuelve lotes en espera con solicitudes originales", async () => {
  const h = harness(simulate);
  const pending = Promise.all([h.fetch(simulation([item(1)])), h.fetch(simulation([item(2)]))]);
  await settle(); h.settings({ enabled: false });
  await pending; await h.tick(25);
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every(call => core.variablesFrom(call.input, "").items.length === 1));
});

test("una búsqueda grande no se clona/indexa si experimental está apagado", async () => {
  const response = json({ data: { productSearch: { products: [] } } });
  response.clone = () => { throw new Error("No debe clonar"); };
  const h = harness(() => response);
  assert.equal(await h.fetch(query("productSearchV3")), response);
});

test("un lote bloqueado se cancela a los 8 segundos y recupera las solicitudes originales", async () => {
  const h = harness((input, init) => {
    if (core.variablesFrom(input, "").items.length === 1) return simulate(input);
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  });
  const pending = Promise.all([h.fetch(simulation([item(1)])), h.fetch(simulation([item(2)]))]);
  await h.tick(25);
  await h.tick(8000);
  assert.equal((await pending).length, 2);
  assert.equal(h.calls.length, 3);
});

test("un lote anterior a una mutación no rellena la caché con precios viejos", async () => {
  const batch = deferred();
  const h = harness((input) => {
    if (String(input).includes("orderForm")) return json({ orderFormId: "test" });
    if (core.variablesFrom(input, "").items.length > 1) return batch.promise;
    return simulate(input);
  });
  const first = h.fetch(simulation([item(1)]));
  const second = h.fetch(simulation([item(2)]));
  await h.tick(25);
  await h.fetch(`${ORIGIN}/api/checkout/pub/orderForm/test/items`, { method: "POST", body: "{}" });
  batch.resolve(simulate(h.calls[0].input));
  await Promise.all([first, second]);
  await h.tick(5001);
  const fresh = h.fetch(simulation([item(1)]));
  await h.tick(25); await fresh;
  assert.equal(h.calls.length, 3);
});

test("caché fiscal reutiliza fragmentos pero separa precios y contexto adicional", async () => {
  const h = harness(input => {
    const { products } = core.variablesFrom(input, "");
    return json({ data: { getPriceWithoutTax: products.map(product => ({ skuId: product.skuId, productId: product.productId, priceWithoutTax: product.price / 1.21 })) } });
  });
  const a = { skuId: "1", productId: "10", price: 121 };
  const b = { skuId: "2", productId: "20", price: 242 };
  const tax = (products, region = "A") => query("GetPriceWithoutTax", { products, sellers: ["1"], region });
  await h.fetch(tax([a, b]));
  const subset = await (await h.fetch(tax([b]))).json();
  assert.equal(subset.data.getPriceWithoutTax[0].priceWithoutTax, 200);
  assert.equal(h.calls.length, 1);
  await h.fetch(tax([{ ...a, price: 242 }]));
  await h.fetch(tax([a], "B"));
  assert.equal(h.calls.length, 3);
});

test("caché expirada vuelve a la red", async () => {
  const h = harness();
  await h.fetch(query("ProductQuery"));
  await h.tick(300001);
  await h.fetch(query("ProductQuery"));
  assert.equal(h.calls.length, 2);
});

test("signal ya abortada no se satisface con la caché", async () => {
  const h = harness((_input, init) => {
    if (init?.signal?.aborted) throw init.signal.reason;
    return json({ data: {} });
  });
  await h.fetch(query("ProductQuery"));
  await assert.rejects(h.fetch(query("ProductQuery"), { signal: AbortSignal.abort() }), { name: "AbortError" });
  assert.equal(h.calls.length, 1);
});

test("cada remonte con una señal nueva reutiliza la respuesta guardada", async () => {
  const h = harness();
  const url = query("ProductQuery");
  await (await h.fetch(url, { signal: new AbortController().signal })).json();
  await (await h.fetch(url, { signal: new AbortController().signal })).json();
  assert.equal(h.calls.length, 1);
});

test("cancelar el último consumidor aborta la red compartida y permite un remonte nuevo", async () => {
  const h = harness((_input, init, count) => count === 1 ? new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }) : json({ data: {} }));
  const controller = new AbortController();
  const pending = h.fetch(query("ProductQuery"), { signal: controller.signal });
  const check = assert.rejects(pending, { name: "AbortError" });
  await settle(); controller.abort(); await check;
  assert.equal(h.calls[0].init.signal.aborted, true);
  await (await h.fetch(query("ProductQuery"), { signal: new AbortController().signal })).json();
  assert.equal(h.calls.length, 2);
});

test("abortar después de recibir headers cancela solamente el cuerpo de ese consumidor", async () => {
  const h = harness();
  const controller = new AbortController();
  const [first, second] = await Promise.all([
    h.fetch(query("ProductQuery"), { signal: controller.signal }),
    h.fetch(query("ProductQuery"), { signal: new AbortController().signal })
  ]);
  controller.abort();
  await assert.rejects(first.json(), { name: "AbortError" });
  assert.deepEqual(await second.json(), { data: { ok: true } });
  assert.equal(h.calls.length, 1);
});

test("tarjeta desmontada antes de enviar el lote no dispara consultas ni reintentos", async () => {
  const h = harness(simulate);
  const controller = new AbortController();
  const first = h.fetch(simulation([item(1)]), { signal: controller.signal });
  const check = assert.rejects(first, { name: "AbortError" });
  const second = h.fetch(simulation([item(2)]), { signal: new AbortController().signal });
  await settle(); controller.abort(); await check;
  await h.tick(25); await second;
  assert.equal(h.calls.length, 1);
  assert.equal(core.variablesFrom(h.calls[0].input, "").items[0].itemId, "2");
});

test("desmontar una tarjeta no cancela el lote que necesitan las demás", async () => {
  const result = deferred();
  const h = harness(() => result.promise);
  const controller = new AbortController();
  const first = h.fetch(simulation([item(1)]), { signal: controller.signal });
  const check = assert.rejects(first, { name: "AbortError" });
  const second = h.fetch(simulation([item(2)]), { signal: new AbortController().signal });
  await h.tick(25); controller.abort(); await check;
  assert.equal(h.calls[0].init.signal.aborted, false);
  result.resolve(simulate(h.calls[0].input));
  assert.equal((await (await second).json()).data.itemsWithSimulation[0].itemId, "2");
  assert.equal(h.calls.length, 1);
});

test("cancelar todas las tarjetas de un lote aborta la red sin fallback", async () => {
  const h = harness((_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }));
  const controllers = [new AbortController(), new AbortController()];
  const checks = controllers.map((controller, index) => assert.rejects(h.fetch(simulation([item(index)]), { signal: controller.signal }), { name: "AbortError" }));
  await h.tick(25);
  controllers.forEach(controller => controller.abort());
  await Promise.all(checks); await settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].init.signal.aborted, true);
});

test("consultar el carrito por GET no vacía la caché del catálogo", async () => {
  const h = harness();
  await h.fetch(query("ProductQuery"));
  await h.fetch(`${ORIGIN}/api/checkout/pub/orderForm/test`);
  await h.fetch(query("ProductQuery"));
  assert.equal(h.calls.length, 2);
});

test("formato real VTEX variables={} y AbortSignal agrupa y reutiliza al volver", async () => {
  const h = harness(simulate);
  const urls = Array.from({ length: 12 }, (_, i) => {
    const url = new URL(simulation([item(i)]));
    url.searchParams.set("variables", "{}");
    return url.href;
  });
  const controllers = urls.map(() => new AbortController());
  const pending = Promise.all(urls.map((url, i) => h.fetch(new Request(url, { signal: controllers[i].signal }))));
  await h.tick(25);
  await Promise.all((await pending).map(response => response.json()));
  controllers.forEach(controller => controller.abort());
  const repeated = await Promise.all(urls.map(url => h.fetch(url, { signal: new AbortController().signal })));
  await Promise.all(repeated.map(response => response.json()));
  assert.equal(h.calls.length, 1);
  assert.equal(new URL(h.calls[0].input).searchParams.get("variables"), "{}");
});

test("variables estándar no vacías se preservan sin agrupar", async () => {
  const h = harness(simulate);
  const urls = [1, 2].map(id => {
    const url = new URL(simulation([item(id)]));
    url.searchParams.set("variables", JSON.stringify({ channel: "2" }));
    return url.href;
  });
  await Promise.all(urls.map(url => h.fetch(url, { signal: new AbortController().signal })));
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every(call => new URL(call.input).searchParams.get("variables") === '{"channel":"2"}'));
});
