(function startContentBridge() {
  "use strict";
  const defaults = {
    enabled: true,
    dedupe: true,
    batchSimulation: true,
    experimental: false,
    syntheticProductQuery: false,
    syntheticHighlights: false,
    syntheticSimulation: false
  };

  function sendSettings(settings) {
    window.dispatchEvent(new CustomEvent("masonline-turbo:settings", { detail: settings }));
  }

  const refreshSettings = () => chrome.storage.local.get(defaults).then(sendSettings).catch(() => {});
  refreshSettings();
  window.addEventListener("masonline-turbo:ready", refreshSettings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const update = {};
    for (const key of Object.keys(defaults)) {
      if (changes[key]) update[key] = changes[key].newValue ?? defaults[key];
    }
    if (Object.keys(update).length) sendSettings(update);
  });

  let pendingMetrics;
  let metricsTimer;
  let lastError;
  const metricKeys = ["observed", "network", "deduplicated", "cacheHits", "synthetic", "productsIndexed", "fallbacks"];
  window.addEventListener("masonline-turbo:metrics", event => {
    if (!event.detail || typeof event.detail !== "object") return;
    pendingMetrics = Object.fromEntries(metricKeys.map(key => [key,
      Number.isSafeInteger(event.detail[key]) && event.detail[key] >= 0 ? event.detail[key] : 0
    ]));
    if (metricsTimer) return;
    metricsTimer = setTimeout(() => {
      metricsTimer = undefined;
      // storage.session is restricted to trusted extension contexts by default.
      try {
        chrome.runtime.sendMessage({ type: "masonline-turbo:metrics", metrics: pendingMetrics, lastError }).catch(() => {});
      } catch (_) { /* The extension may have been reloaded while this tab stayed open. */ }
    }, 1000);
  });

  window.addEventListener("masonline-turbo:error", event => {
    if (event.detail?.adapter === "batchSimulation") lastError = "La agrupación utilizó la red como alternativa.";
  });

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === "masonline-turbo:stats") {
      respond({ metrics: pendingMetrics || {}, lastError });
    }
    if (message?.type === "masonline-turbo:clear") {
      pendingMetrics = {};
      lastError = undefined;
      window.dispatchEvent(new CustomEvent("masonline-turbo:clear"));
      respond({ ok: true });
    }
  });
})();
