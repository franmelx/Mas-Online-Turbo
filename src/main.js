(function startMasOnlineTurbo() {
  "use strict";

  if (window.__MASONLINE_TURBO_ACTIVE__) return;
  window.__MASONLINE_TURBO_ACTIVE__ = true;
  const core = window.__MASONLINE_TURBO_CORE__;
  const nativeFetch = window.fetch.bind(window);
  const inflight = new Map();
  const responseCache = new Map();
  const simulationItemCache = new Map();
  const taxItemCache = new Map();
  const productsBySku = new Map();
  const failures = new Map();
  const simulationBatches = new Map();
  let settings = {
    enabled: true, dedupe: true, batchSimulation: true, experimental: false,
    syntheticProductQuery: false, syntheticHighlights: false, syntheticSimulation: false
  };
  let metrics = {
    observed: 0, network: 0, deduplicated: 0, cacheHits: 0,
    synthetic: 0, productsIndexed: 0, fallbacks: 0
  };
  const operationTtl = {
    itemsWithSimulation: 60000, ProductQuery: 300000, productsByIdentifier: 300000,
    CustomHighlightsProductClusters: 300000, GetPriceWithoutTax: 120000,
    productSuggestions: 120000, banners: 120000
  };
  const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
  const MAX_CACHE_BYTES = 16 * 1024 * 1024;
  const MAX_CACHE_ENTRIES = 200;
  const MAX_FRAGMENT_ENTRIES = 1000;
  const MAX_BATCH_ITEMS = 40;
  const MAX_BATCH_URL = 8000;
  let cacheBytes = 0;
  let generation = 0;
  let context = "";
  let activeWrites = 0;
  let cartBypassUntil = 0;
  let metricsTimer = 0;

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(`masonline-turbo:${name}`, { detail }));
  }

  function emitMetrics() {
    if (metricsTimer) return;
    metricsTimer = window.setTimeout(() => {
      metricsTimer = 0;
      emit("metrics", { ...metrics });
    }, 500);
  }

  function readContext() {
    // Opaque comparison supports JSON and base64 segment cookies without logging them.
    return document.cookie.split(/;\s*/)
      .filter(cookie => /^(vtex_segment|vtex_session)=/.test(cookie)).sort().join(";");
  }

  function bypassing() {
    return activeWrites > 0 || Date.now() < cartBypassUntil;
  }

  function stillCurrent(details) {
    return settings.enabled && details.generation === generation &&
      details.context === readContext() && !bypassing();
  }

  function resetCaches() {
    generation += 1;
    inflight.clear();
    responseCache.clear();
    simulationItemCache.clear();
    taxItemCache.clear();
    productsBySku.clear();
    cacheBytes = 0;
    const pending = [...simulationBatches.values()];
    simulationBatches.clear();
    for (const batch of pending) {
      window.clearTimeout(batch.timer);
      for (const entry of batch.entries) sendOriginal(entry);
    }
  }

  function registerFailure(adapter) {
    const count = (failures.get(adapter) || 0) + 1;
    failures.set(adapter, count);
    emit("error", { adapter, count, message: "Optimización omitida; se utiliza la respuesta de la tienda." });
    if (count >= 3 && Object.hasOwn(settings, adapter)) settings[adapter] = false;
  }

  async function requestDetails(input, init) {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), location.href);
    if (url.origin !== "https://www.masonline.com.ar") return { firstParty: false };
    const method = String(init?.method || request?.method || "GET").toUpperCase();
    const graphql = /\/graphql(?:\/|$)/.test(url.pathname);
    let bodyText = typeof init?.body === "string" ? init.body : "";
    // Never clone/read bodies of checkout, login, payment or session requests.
    if (graphql && !bodyText && request && !init?.body && method === "POST") {
      bodyText = await request.clone().text();
    }
    const operation = core.operationFrom(url.href, bodyText);
    const nextContext = readContext();
    if (nextContext !== context) {
      context = nextContext;
      resetCaches();
    }
    const headers = new Headers(init?.headers ?? request?.headers);
    const options = {
      headers: [...headers.entries()].sort(([a], [b]) => a.localeCompare(b)),
      credentials: init?.credentials ?? request?.credentials ?? "same-origin",
      mode: init?.mode ?? request?.mode ?? "cors",
      cache: init?.cache ?? request?.cache ?? "default",
      redirect: init?.redirect ?? request?.redirect ?? "follow",
      referrer: init?.referrer ?? request?.referrer ?? "about:client",
      referrerPolicy: init?.referrerPolicy ?? request?.referrerPolicy ?? "",
      integrity: init?.integrity ?? request?.integrity ?? "",
      keepalive: init?.keepalive ?? request?.keepalive ?? false
    };
    let canonicalBody = bodyText;
    try { canonicalBody = core.stableStringify(JSON.parse(bodyText)); } catch (_) {}
    const variant = core.stableStringify(options);
    const key = `${generation}|${method}|${core.canonicalUrl(url.href)}|${variant}|${canonicalBody}`;
    return {
      url: url.href, pathname: url.pathname, method, operation, graphql,
      variables: core.variablesFrom(url.href, bodyText), key, variant,
      generation, context, firstParty: true,
      signal: init?.signal !== undefined ? init.signal : request?.signal,
      transport: { ...options, method, ...init, headers },
      skipCache: options.cache !== "default" || headers.has("authorization") ||
        headers.has("range") || headers.has("cache-control") || options.integrity !== "" ||
        options.keepalive || url.username !== "" || url.password !== ""
    };
  }

  function successfulJson(response, payload) {
    return response.status === 200 && !response.redirected && payload && typeof payload === "object" &&
      !Object.hasOwn(payload, "errors") && !/no-store|no-cache|private/i.test(response.headers.get("cache-control") || "") &&
      response.headers.get("vary") !== "*";
  }

  async function readBounded(response) {
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES || !response.body) return null;
    const reader = response.clone().body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          void reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(value);
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
      return body;
    } finally { reader.releaseLock(); }
  }

  function restore(saved) {
    return new Response(saved.body, { status: saved.status, statusText: saved.statusText, headers: saved.headers });
  }

  function jsonResponse(payload) {
    return new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json; charset=utf-8", "x-masonline-turbo": "local" }
    });
  }

  function abortReason(signal) {
    return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  }

  function responseForCaller(response, signal) {
    if (!signal) return response;
    if (signal.aborted) throw abortReason(signal);
    if (!response.body) return response;
    const reader = response.body.getReader();
    let onAbort;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const body = new ReadableStream({
      start(controller) {
        onAbort = () => {
          cleanup();
          controller.error(abortReason(signal));
          void reader.cancel(abortReason(signal)).catch(() => {});
        };
        signal.addEventListener("abort", onAbort, { once: true });
      },
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (signal.aborted) return;
          if (done) { cleanup(); controller.close(); }
          else controller.enqueue(value);
        } catch (error) { cleanup(); if (!signal.aborted) controller.error(error); }
      },
      cancel(reason) { cleanup(); return reader.cancel(reason); }
    }, { highWaterMark: 0 });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  function subscribe(record, details) {
    const signal = details.signal;
    return new Promise((resolve, reject) => {
      const consumer = {};
      let finished = false;
      const cleanup = () => {
        finished = true;
        record.consumers.delete(consumer);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (finished) return;
        cleanup();
        reject(abortReason(signal));
        if (!record.settled && record.consumers.size === 0) {
          if (inflight.get(details.key) === record) inflight.delete(details.key);
          record.controller.abort(abortReason(signal));
        }
      };
      record.consumers.add(consumer);
      signal?.addEventListener("abort", onAbort, { once: true });
      // Keep rejection handlers attached even after every consumer cancels.
      record.promise.then(result => {
        if (finished) return;
        try {
          const response = result.saved ? restore(result.saved) : result.response.clone();
          const delivered = responseForCaller(response, signal);
          cleanup();
          resolve(delivered);
        } catch (error) { cleanup(); reject(error); }
      }, error => { if (!finished) { cleanup(); reject(error); } });
      if (signal?.aborted) onAbort();
    });
  }

  function cacheGet(map, key) {
    const entry = map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      map.delete(key);
      cacheBytes -= entry.bytes;
      return null;
    }
    map.delete(key);
    map.set(key, entry);
    return entry.value;
  }

  function cachePut(map, key, value, ttl, bytes) {
    bytes += key.length * 2;
    if (bytes > MAX_CACHE_BYTES) return;
    if (map.has(key)) { cacheBytes -= map.get(key).bytes; map.delete(key); }
    map.set(key, { value, expiresAt: Date.now() + ttl, bytes });
    cacheBytes += bytes;
    const limit = map === responseCache ? MAX_CACHE_ENTRIES : MAX_FRAGMENT_ENTRIES;
    while (map.size > limit) evictOldest(map);
    for (const candidate of [responseCache, simulationItemCache, taxItemCache, productsBySku]) {
      while (cacheBytes > MAX_CACHE_BYTES && candidate.size) evictOldest(candidate);
    }
  }

  function evictOldest(map) {
    const key = map.keys().next().value;
    cacheBytes -= map.get(key).bytes;
    map.delete(key);
  }

  function fragmentScope(details, omitted) {
    const url = new URL(details.url);
    const extensions = JSON.parse(url.searchParams.get("extensions") || "{}");
    delete extensions.variables;
    url.searchParams.set("extensions", core.stableStringify(extensions));
    const variables = { ...details.variables };
    delete variables[omitted];
    return `${details.generation}|${core.canonicalUrl(url.href)}|${details.variant}|${core.stableStringify(variables)}`;
  }

  function fragmentKey(scope, item) {
    return `${scope}|${core.stableStringify(item)}`;
  }

  function fragmentedResponse(details) {
    if (details.method !== "GET" || !details.variables) return null;
    const simulation = details.operation === "itemsWithSimulation";
    if (!simulation && details.operation !== "GetPriceWithoutTax") return null;
    if (simulation && !settings.batchSimulation) return null;
    const field = simulation ? "items" : "products";
    const requested = details.variables[field];
    if (!Array.isArray(requested) || !requested.length) return null;
    const scope = fragmentScope(details, field);
    const map = simulation ? simulationItemCache : taxItemCache;
    const values = requested.map(item => cacheGet(map, fragmentKey(scope, item)));
    if (values.some(value => !value)) return null;
    return { data: { [simulation ? "itemsWithSimulation" : "getPriceWithoutTax"]: values } };
  }

  function capture(details, payload) {
    if (!stillCurrent(details)) return;
    if (details.operation === "itemsWithSimulation" && batchEligible(details)) {
      const received = payload?.data?.itemsWithSimulation;
      if (Array.isArray(received)) {
        const scope = fragmentScope(details, "items");
        for (const requested of details.variables.items) {
          const matches = received.filter(item => item && String(item.itemId) === String(requested.itemId) &&
            Array.isArray(item.sellers) && sellerKey(item) === sellerKey(requested));
          if (matches.length === 1) cachePut(simulationItemCache, fragmentKey(scope, requested), matches[0], 60000, JSON.stringify(matches[0]).length * 2);
        }
      }
    }
    if (details.operation === "GetPriceWithoutTax" && details.method === "GET") {
      const requested = details.variables?.products;
      const received = payload?.data?.getPriceWithoutTax;
      if (Array.isArray(requested) && Array.isArray(received)) {
        const scope = fragmentScope(details, "products");
        for (const source of requested) {
          const matches = requested.filter(item => String(item.skuId) === String(source.skuId) && String(item.productId) === String(source.productId));
          const values = received.filter(item => String(item.skuId) === String(source.skuId) && String(item.productId) === String(source.productId));
          if (matches.length === 1 && values.length === 1) {
            cachePut(taxItemCache, fragmentKey(scope, source), values[0], 120000, JSON.stringify(values[0]).length * 2);
          }
        }
      }
    }
    if (!settings.experimental) return;
    const products = payload?.data?.productSearch?.products || payload?.data?.productSuggestions?.products;
    if (!Array.isArray(products)) return;
    for (const product of products) {
      if (!product || !Array.isArray(product.items)) continue;
      const bytes = JSON.stringify(product).length * 2;
      for (const item of product.items) {
        if (item?.itemId) cachePut(productsBySku, String(item.itemId), product, 60000, bytes);
      }
    }
    metrics.productsIndexed += products.length;
    emitMetrics();
  }

  function syntheticResponse(details) {
    if (!settings.experimental) return null;
    if (details.operation === "itemsWithSimulation" && settings.syntheticSimulation) {
      return core.makeItemSimulation(details.variables, sku => cacheGet(productsBySku, sku));
    }
    const product = cacheGet(productsBySku, String(details.variables?.sku));
    if (!product) return null;
    if (details.operation === "ProductQuery" && settings.syntheticProductQuery) return core.makeProductQuery(product);
    if (details.operation === "CustomHighlightsProductClusters" && settings.syntheticHighlights) return core.makeHighlights(product);
    return null;
  }

  async function network(input, init) {
    metrics.network += 1;
    emitMetrics();
    return nativeFetch(input, init);
  }

  async function networkAndCapture(input, init, details) {
    const response = await network(input, init);
    if (settings.experimental && ["productSearchV3", "productSuggestions"].includes(details.operation) && stillCurrent(details)) {
      void readBounded(response).then(body => {
        if (!body) return;
        const payload = JSON.parse(new TextDecoder().decode(body));
        if (successfulJson(response, payload)) capture(details, payload);
      }).catch(() => {});
    }
    return response;
  }

  function cacheTtl(details) {
    if (operationTtl[details.operation]) return operationTtl[details.operation];
    if (details.pathname.startsWith("/api/dataentities/DF/")) return 120000;
    if (details.pathname.startsWith("/api/dataentities/CP/")) return 60000;
    return 0;
  }

  async function sharedRead(input, init, details) {
    const response = await network(input, init);
    if (response.status !== 200 || response.redirected || !/json/i.test(response.headers.get("content-type") || "")) return { response };
    try {
      const body = await readBounded(response);
      if (!body) return { response };
      const payload = JSON.parse(new TextDecoder().decode(body));
      if (!successfulJson(response, payload)) return { response };
      const headers = new Headers(response.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      const saved = { body, headers: [...headers], status: response.status, statusText: response.statusText };
      if (stillCurrent(details) && !init?.signal?.aborted) {
        capture(details, payload);
        const ttl = cacheTtl(details);
        if (ttl) cachePut(responseCache, details.key, saved, ttl, body.byteLength);
      }
      return { saved };
    } catch (_) { return { response }; }
  }

  function batchEligible(details) {
    const variables = details.variables;
    if (!variables || details.method !== "GET" || !Array.isArray(variables.items) || !variables.items.length) return false;
    const url = new URL(details.url);
    // VTEX sends variables={} alongside extensions.variables. Only non-empty
    // standard variables require a different merge contract.
    if (url.searchParams.has("variables")) {
      try {
        const standard = JSON.parse(url.searchParams.get("variables"));
        if (!standard || Array.isArray(standard) || typeof standard !== "object" || Object.keys(standard).length) return false;
      } catch (_) { return false; }
    }
    return variables.items.length <= MAX_BATCH_ITEMS && variables.items.every(item =>
      item && item.itemId != null && Object.keys(item).every(key => ["itemId", "sellers"].includes(key)) &&
      Array.isArray(item.sellers) && item.sellers.length > 0 && item.sellers.every(seller =>
        seller && seller.sellerId != null && Object.keys(seller).every(key => key === "sellerId")));
  }

  function makeBatchUrl(details, items) {
    const url = new URL(details.url);
    const extensions = JSON.parse(url.searchParams.get("extensions"));
    extensions.variables = core.encodeBase64Json({ ...details.variables, items });
    url.searchParams.set("extensions", JSON.stringify(extensions));
    return url.href;
  }

  function sendOriginal(entry) {
    if (entry.init?.signal?.aborted) { entry.reject(abortReason(entry.init.signal)); return; }
    metrics.fallbacks += 1;
    network(entry.input, entry.init).then(entry.resolve, entry.reject);
  }

  function mergedItems(entries) {
    const byId = new Map();
    for (const entry of entries) {
      for (const item of entry.details.variables.items) {
        const id = String(item.itemId);
        if (byId.has(id) && core.stableStringify(byId.get(id)) !== core.stableStringify(item)) return null;
        byId.set(id, item);
      }
    }
    return [...byId.values()];
  }

  function queueSimulation(input, init, details) {
    const key = fragmentScope(details, "items");
    return new Promise((resolve, reject) => {
      const signal = init.signal;
      if (signal?.aborted) { reject(abortReason(signal)); return; }
      const finish = callback => value => {
        signal?.removeEventListener("abort", onAbort);
        callback(value);
      };
      const entry = { input, init, details, resolve: finish(resolve), reject: finish(reject) };
      const onAbort = () => {
        const queued = simulationBatches.get(key);
        if (queued?.entries.includes(entry)) {
          queued.entries = queued.entries.filter(candidate => candidate !== entry);
          if (!queued.entries.length) {
            window.clearTimeout(queued.timer);
            simulationBatches.delete(key);
          }
        }
        entry.reject(abortReason(signal));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      let batch = simulationBatches.get(key);
      if (batch) {
        const items = mergedItems([...batch.entries, entry]);
        if (!items || items.length > MAX_BATCH_ITEMS || batch.entries.length >= MAX_BATCH_ITEMS || makeBatchUrl(details, items).length > MAX_BATCH_URL) {
          void flushSimulation(key);
          batch = null;
        }
      }
      if (!batch) {
        const items = mergedItems([entry]);
        if (!items || makeBatchUrl(details, items).length > MAX_BATCH_URL) { sendOriginal(entry); return; }
        batch = { entries: [], timer: window.setTimeout(() => void flushSimulation(key), 25) };
        simulationBatches.set(key, batch);
      }
      batch.entries.push(entry);
    });
  }

  function sellerKey(item) {
    return core.stableStringify((item.sellers || []).map(seller => String(seller.sellerId)).sort());
  }

  async function flushSimulation(key) {
    const batch = simulationBatches.get(key);
    if (!batch) return;
    window.clearTimeout(batch.timer);
    simulationBatches.delete(key);
    const first = batch.entries[0];
    if (batch.entries.length === 1) {
      sharedRead(first.input, first.init, first.details).then(result => first.resolve(result.saved ? restore(result.saved) : result.response), first.reject);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    const cancelIfUnused = () => {
      if (batch.entries.every(entry => entry.init.signal?.aborted)) controller.abort();
    };
    for (const entry of batch.entries) entry.init.signal?.addEventListener("abort", cancelIfUnused);
    try {
      const items = mergedItems(batch.entries);
      const response = await network(makeBatchUrl(first.details, items), { ...first.details.transport, signal: controller.signal });
      if (!response.ok) throw new Error("batch-http");
      const body = await readBounded(response);
      if (!body) throw new Error("batch-size");
      const payload = JSON.parse(new TextDecoder().decode(body));
      const received = payload?.data?.itemsWithSimulation;
      if (!successfulJson(response, payload) || !Array.isArray(received)) throw new Error("batch-payload");
      // Validate every entry before resolving any of them.
      const results = batch.entries.map(entry => entry.details.variables.items.map(requested => {
        const matches = received.filter(item => item && String(item.itemId) === String(requested.itemId) &&
          Array.isArray(item.sellers) && sellerKey(item) === sellerKey(requested));
        if (matches.length !== 1) throw new Error("batch-sellers");
        return matches[0];
      }));
      for (let i = 0; i < batch.entries.length; i += 1) {
        const entry = batch.entries[i];
        if (stillCurrent(entry.details) && !entry.init.signal?.aborted) {
          const scope = fragmentScope(entry.details, "items");
          entry.details.variables.items.forEach((requested, index) => {
            const value = results[i][index];
            cachePut(simulationItemCache, fragmentKey(scope, requested), value, 60000, JSON.stringify(value).length * 2);
          });
        }
        entry.resolve(jsonResponse({ ...payload, data: { ...payload.data, itemsWithSimulation: results[i] } }));
      }
      metrics.deduplicated += batch.entries.length - 1;
      emitMetrics();
    } catch (_) {
      const active = batch.entries.filter(entry => !entry.init.signal?.aborted);
      if (active.length) registerFailure("batchSimulation");
      for (const entry of active) sendOriginal(entry);
    } finally {
      window.clearTimeout(timeout);
      for (const entry of batch.entries) entry.init.signal?.removeEventListener("abort", cancelIfUnused);
    }
  }

  async function optimizedRead(input, init, details) {
    if (details.signal?.aborted) throw abortReason(details.signal);
    const cached = settings.dedupe && cacheGet(responseCache, details.key);
    if (cached) { metrics.cacheHits += 1; emitMetrics(); return responseForCaller(restore(cached), details.signal); }
    let fragment, synthetic;
    try { fragment = fragmentedResponse(details); synthetic = fragment ? null : syntheticResponse(details); }
    catch (_) { return network(input, init); }
    if (fragment) { metrics.cacheHits += 1; emitMetrics(); return responseForCaller(jsonResponse(fragment), details.signal); }
    if (synthetic) { metrics.synthetic += 1; emitMetrics(); return responseForCaller(jsonResponse(synthetic), details.signal); }

    const existing = settings.dedupe && inflight.get(details.key);
    if (existing) {
      metrics.deduplicated += 1;
      emitMetrics();
      return subscribe(existing, details);
    }
    const batch = settings.batchSimulation && details.operation === "itemsWithSimulation" && batchEligible(details);
    if (!settings.dedupe && !batch) return networkAndCapture(input, init, details);
    const record = { controller: new AbortController(), consumers: new Set(), settled: false };
    const transport = { ...init, signal: record.controller.signal };
    const pending = batch
      ? queueSimulation(input, transport, details).then(response => ({ response }))
      : sharedRead(input, transport, details);
    record.promise = pending.finally(() => {
      record.settled = true;
      if (inflight.get(details.key) === record) inflight.delete(details.key);
    });
    if (settings.dedupe) inflight.set(details.key, record);
    return subscribe(record, details);
  }

  async function turboFetch(input, init) {
    let details;
    try { details = await requestDetails(input, init); }
    catch (_) { return nativeFetch(input, init); }
    if (!details.firstParty) return nativeFetch(input, init);
    metrics.observed += 1;

    const knownRead = details.graphql && ["GET", "POST"].includes(details.method) && core.READ_OPERATIONS.has(details.operation);
    const authentication = /\/vtexid\//.test(details.pathname);
    const write = (!knownRead && !["GET", "HEAD", "OPTIONS"].includes(details.method)) || authentication;
    if (write) {
      activeWrites += 1;
      resetCaches();
      try { return await network(input, init); }
      finally {
        activeWrites -= 1;
        cartBypassUntil = Date.now() + 5000;
        resetCaches();
      }
    }
    if (!settings.enabled || bypassing() || details.skipCache) return network(input, init);
    const safe = core.isSafeRead(details.method, details.operation, details.pathname);
    if (!safe) return networkAndCapture(input, init, details);
    return optimizedRead(input, init, details);
  }

  window.fetch = turboFetch;
  window.addEventListener("masonline-turbo:settings", event => {
    if (!event.detail || typeof event.detail !== "object") return;
    let changed = false;
    for (const key of Object.keys(settings)) {
      if (typeof event.detail[key] === "boolean" && event.detail[key] !== settings[key]) {
        settings[key] = event.detail[key];
        changed = true;
      }
    }
    if (changed) { failures.clear(); resetCaches(); }
    emit("settings-applied", { ...settings });
  });
  window.addEventListener("masonline-turbo:request-metrics", emitMetrics);
  window.addEventListener("masonline-turbo:clear", () => {
    resetCaches();
    failures.clear();
    if (metricsTimer) window.clearTimeout(metricsTimer);
    metricsTimer = 0;
    metrics = Object.fromEntries(Object.keys(metrics).map(key => [key, 0]));
    emitMetrics();
  });
  emit("ready", { version: "0.4.2" });
  emitMetrics();
})();
