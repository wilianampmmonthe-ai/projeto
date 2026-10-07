"use strict";

const assert = require("node:assert/strict");
const [port = "9335", baseUrl = "http://127.0.0.1:8765"] = process.argv.slice(2);

async function main() {
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const tab = tabs.find((item) => item.type === "page");
  if (!tab) throw new Error("Nenhuma pagina disponivel para auditoria responsiva.");

  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  let loadResolver;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    } else if (message.method === "Page.loadEventFired" && loadResolver) {
      loadResolver();
      loadResolver = null;
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const command = (method, params = {}) => {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const evaluate = async (expression) => {
    const response = await command("Runtime.evaluate", { expression, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };

  await command("Page.enable");
  await command("Runtime.enable");
  const loaded = new Promise((resolve) => { loadResolver = resolve; });
  await command("Page.navigate", { url: `${baseUrl}/index.html` });
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, 500));

  const viewports = [
    [1440, 900, false], [1366, 768, false], [1024, 768, false], [768, 900, true], [390, 844, true],
  ];
  const pages = ["dashboard", "terceirizados", "atacarejo", "empresas", "frequencia", "efetivo", "ata-terc", "ata-atac", "admin"];
  const layout = [];

  for (const [width, height, mobile] of viewports) {
    await command("Emulation.setDeviceMetricsOverride", {
      width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile,
    });
    const login = await evaluate(`(() => {
      document.getElementById('app').style.display = 'none';
      document.getElementById('loginScreen').style.display = 'grid';
      return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth };
    })()`);
    assert.ok(login.documentWidth <= login.viewport, `Login gerou overflow em ${width}px`);

    await evaluate(`document.getElementById('loginScreen').style.display='none'; document.getElementById('app').style.display='block';`);
    for (const theme of ["dark", "light"]) {
      for (const page of pages) {
        const metric = await evaluate(`(() => {
          document.body.classList.toggle('light', '${theme}' === 'light');
          document.body.classList.toggle('dark', '${theme}' === 'dark');
          document.querySelectorAll('.page').forEach((item) => item.classList.toggle('active', item.id === 'page-${page}' || item.id === '${page}-page'));
          return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth };
        })()`);
        assert.ok(metric.documentWidth <= metric.viewport, `${page}/${theme} gerou overflow em ${width}px`);
        assert.ok(metric.bodyWidth <= metric.viewport, `${page}/${theme} excedeu o body em ${width}px`);
        layout.push({ width, theme, page });
      }
    }
  }

  const accessibility = await evaluate(`(() => ({
    dialogsWithoutRole: [...document.querySelectorAll('.modal-overlay > .modal')].filter((item) => item.getAttribute('role') !== 'dialog').length,
    closeWithoutName: [...document.querySelectorAll('.modal-close')].filter((item) => !item.getAttribute('aria-label') && !item.getAttribute('title')).length,
    controlsWithoutName: [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter((item) => {
      const id = item.id;
      return !item.getAttribute('aria-label') && !item.getAttribute('title') && !(id && document.querySelector('label[for="' + CSS.escape(id) + '"]')) && !item.closest('label');
    }).length,
  }))()`);
  assert.deepEqual(accessibility, { dialogsWithoutRole: 0, closeWithoutName: 0, controlsWithoutName: 0 });

  socket.close();
  console.log(JSON.stringify({ status: "ok", combinations: layout.length, viewports: viewports.map(([width, height]) => `${width}x${height}`), accessibility }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
