const [port = "9333", targetUrl = "http://127.0.0.1:8765/index.html"] = process.argv.slice(2);

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function main() {
  const tabs = await getJson(`http://127.0.0.1:${port}/json`);
  const tab = tabs.find((item) => item.type === "page");
  if (!tab) throw new Error("Nenhuma página disponível no Chrome DevTools Protocol.");

  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  let sequence = 0;
  const pending = new Map();
  const requests = new Map();
  let resolveLoaded;
  const loaded = new Promise((resolve) => { resolveLoaded = resolve; });

  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    const { method, params = {} } = message;
    if (method === "Page.loadEventFired") resolveLoaded();
    if (method === "Network.requestWillBeSent") {
      requests.set(params.requestId, {
        url: params.request.url,
        type: params.type,
        encodedBytes: 0,
        decodedBytes: 0
      });
    }
    if (method === "Network.responseReceived") {
      const entry = requests.get(params.requestId);
      if (entry) {
        entry.status = params.response.status;
        entry.mimeType = params.response.mimeType;
        entry.fromDiskCache = Boolean(params.response.fromDiskCache);
        entry.fromServiceWorker = Boolean(params.response.fromServiceWorker);
      }
    }
    if (method === "Network.dataReceived") {
      const entry = requests.get(params.requestId);
      if (entry) {
        entry.encodedBytes += params.encodedDataLength || 0;
        entry.decodedBytes += params.dataLength || 0;
      }
    }
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  function command(method, params = {}) {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  await command("Network.enable");
  await command("Network.setCacheDisabled", { cacheDisabled: true });
  await command("Page.enable");
  await command("Page.navigate", { url: targetUrl });
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const evaluated = await command("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const resources = performance.getEntriesByType("resource");
      const paint = Object.fromEntries(performance.getEntriesByType("paint").map((item) => [item.name, item.startTime]));
      const scripts = Array.from(document.scripts, (script) => script.src || "inline");
      return {
        timing: navigation ? {
          domContentLoaded: navigation.domContentLoadedEventEnd,
          load: navigation.loadEventEnd,
          firstPaint: paint["first-paint"] || null,
          firstContentfulPaint: paint["first-contentful-paint"] || null
        } : null,
        resourceDecodedBytes: resources.reduce((sum, item) => sum + (item.decodedBodySize || 0), 0),
        scripts,
        globals: {
          jsPDF: Boolean(window.jspdf?.jsPDF),
          XLSX: Boolean(window.XLSX),
          Chart: Boolean(window.Chart),
          efetivo: typeof window.efetivoInit === "function",
          firebaseStorage: typeof window.firebase?.storage === "function",
          mainLoaded: Boolean(window.__mainLoaded)
        }
      };
    })()`
  });

  const successful = Array.from(requests.values()).filter((entry) => entry.status && entry.status < 400);
  const result = {
    url: targetUrl,
    cacheDisabled: true,
    requestCount: successful.length,
    transferredBytes: successful.reduce((sum, entry) => sum + entry.encodedBytes, 0),
    decodedBytes: successful.reduce((sum, entry) => sum + entry.decodedBytes, 0),
    scriptRequests: successful.filter((entry) => entry.type === "Script").length,
    ...evaluated.result.value,
    resources: successful.map(({ url, type, encodedBytes, decodedBytes, fromDiskCache, fromServiceWorker }) => ({
      url, type, encodedBytes, decodedBytes, fromDiskCache, fromServiceWorker
    }))
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  socket.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
