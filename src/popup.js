const defaults = {
  enabled: true,
  dedupe: true,
  batchSimulation: true,
  experimental: false,
  syntheticProductQuery: false,
  syntheticHighlights: false,
  syntheticSimulation: false
};

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const metricKeys = ["observed", "network", "deduplicated", "cacheHits", "synthetic", "productsIndexed", "fallbacks"];
let tabId;
let connected = false;

function renderMetrics(metrics = {}) {
  for (const key of metricKeys) document.getElementById(key).textContent = String(metrics[key] || 0);
}

async function render() {
  const settings = await chrome.storage.local.get(defaults);
  for (const key of Object.keys(defaults)) document.getElementById(key).checked = settings[key];
  const status = document.getElementById("status");
  status.textContent = connected ? (settings.enabled ? "Activo" : "Pausado") : "Sin conexión";
  for (const key of ["syntheticProductQuery", "syntheticHighlights", "syntheticSimulation"]) {
    document.getElementById(key).disabled = !settings.experimental;
  }
}

for (const key of Object.keys(defaults)) {
  document.getElementById(key).addEventListener("change", event => {
    chrome.storage.local.set({ [key]: event.target.checked }).then(render).catch(showError);
  });
}

document.getElementById("clear").addEventListener("click", async () => {
  try {
    if (!connected || !Number.isInteger(tabId)) return;
    await chrome.tabs.sendMessage(tabId, { type: "masonline-turbo:clear" });
    await chrome.storage.session.remove(`turboMetrics:${tabId}`);
    renderMetrics();
    document.getElementById("notice").textContent = "Caché y métricas de esta pestaña borradas.";
  } catch (_) {
    showError();
  }
});

function showError() {
  document.getElementById("notice").textContent = "Recarga la pestaña de MasOnline para volver a conectar la extensión.";
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[`turboMetrics:${tabId}`]) renderMetrics(changes[`turboMetrics:${tabId}`].newValue);
  if (area === "local") render().catch(showError);
});

(async () => {
  tabId = (await activeTab())?.id;
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: "masonline-turbo:stats" });
    connected = true;
    renderMetrics(result.metrics);
    document.getElementById("notice").textContent = "Métricas de esta pestaña; se actualizan automáticamente.";
  } catch (_) {
    document.getElementById("notice").textContent = "Abre MasOnline y recarga la página si acabas de actualizar la extensión.";
  }
  document.getElementById("clear").disabled = !connected;
  await render();
})().catch(showError);
