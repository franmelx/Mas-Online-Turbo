chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== "install" && reason !== "update") return;
  // Las respuestas sintéticas vuelven a opt-in tras cada actualización.
  chrome.storage.local.set({
    experimental: false,
    syntheticProductQuery: false,
    syntheticHighlights: false,
    syntheticSimulation: false
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "masonline-turbo:metrics" || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0) return;
  try {
    if (new URL(sender.url).origin !== "https://www.masonline.com.ar") return;
  } catch (_) { return; }
  const keys = ["observed", "network", "deduplicated", "cacheHits", "synthetic", "productsIndexed", "fallbacks"];
  const metrics = Object.fromEntries(keys.map(key => [key,
    Number.isSafeInteger(message.metrics?.[key]) && message.metrics[key] >= 0 ? message.metrics[key] : 0
  ]));
  chrome.storage.session.set({ [`turboMetrics:${sender.tab.id}`]: metrics })
    .then(() => respond({ ok: true }), () => respond({ ok: false }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(`turboMetrics:${tabId}`).catch(() => {});
});
