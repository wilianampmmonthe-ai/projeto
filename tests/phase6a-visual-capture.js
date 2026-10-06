"use strict";

const fs = require("node:fs");
const path = require("node:path");

const [port = "9333", baseUrl = "http://127.0.0.1:8765", artifactPrefix = "fase6a-shell"] = process.argv.slice(2);

async function main() {
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const tab = tabs.find((item) => item.type === "page");
  if (!tab) throw new Error("Nenhuma página disponível para captura.");

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

  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.clearDeviceMetricsOverride");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  const loaded = new Promise((resolve) => { loadResolver = resolve; });
  await command("Page.navigate", { url: `${baseUrl}/index.html` });
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const prepareExpression = `(() => {
      document.getElementById('loginScreen').style.setProperty('display', 'none', 'important');
      document.getElementById('app').style.setProperty('display', 'block', 'important');
      document.body.classList.remove('light');
      document.body.classList.add('dark');
      document.querySelector('.active-worksite h3').textContent = 'Maxxima Salvador';
      document.querySelector('.active-worksite p').textContent = 'Salvador — BA';
      document.querySelector('.user-info .u-name').textContent = 'Mariana Silva';
      document.querySelector('.user-info .u-role').textContent = 'Administradora • Ativo';
      const switcher = document.getElementById('obra-switcher');
      switcher.hidden = false;
      document.getElementById('obra-current-name').hidden = false;
      document.getElementById('obra-current-name').textContent = 'Maxxima Salvador';
      document.getElementById('obra-selector').hidden = true;
      document.getElementById('darkmodeBtn').textContent = '☀️ Modo Claro';
      window.DB.obra = { nome: 'Maxxima Salvador', municipio: 'Salvador', uf: 'BA' };
      window.APP_CTX.obraNome = 'Maxxima Salvador';
      window.APP_CTX.obraCidade = 'Salvador';
      window.APP_CTX.obraUF = 'BA';
      window.refreshDashboard();
      window.renderDashTable(window.DB.funcionarios);
      document.getElementById('btnNovoFuncionarioDashboard').style.removeProperty('display');
      return true;
    })()`;
  await command("Runtime.evaluate", { expression: prepareExpression });

  const outputDir = path.join(__dirname, "..", "artifacts");
  fs.mkdirSync(outputDir, { recursive: true });

  await command("Runtime.evaluate", { expression: "window.scrollTo(0, 0); document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebarOverlay').classList.remove('open')" });
  const desktop = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(path.join(outputDir, `${artifactPrefix}-desktop-dark.png`), desktop.data, "base64");

  await command("Runtime.evaluate", { expression: "document.body.classList.remove('dark'); document.body.classList.add('light'); window.scrollTo(0, 0)" });
  await new Promise((resolve) => setTimeout(resolve, 350));
  const lightStyles = await command("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      bodyClass: document.body.className,
      canvasToken: getComputedStyle(document.body).getPropertyValue('--canvas').trim(),
      surfaceToken: getComputedStyle(document.body).getPropertyValue('--surface').trim(),
      content: getComputedStyle(document.querySelector('.content')).backgroundColor,
      card: getComputedStyle(document.querySelector('#page-dashboard .stat-card')).backgroundColor,
      cardColor: getComputedStyle(document.querySelector('#page-dashboard .stat-card')).color,
      overlayOpen: document.getElementById('sidebarOverlay').classList.contains('open'),
      modalsOpen: document.querySelectorAll('.modal-overlay.open').length
    }))()`,
  });
  const desktopLight = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(path.join(outputDir, `${artifactPrefix}-desktop-light.png`), desktopLight.data, "base64");

  await command("Runtime.evaluate", { expression: "document.body.classList.remove('light'); document.body.classList.add('dark')" });
  await new Promise((resolve) => setTimeout(resolve, 350));

  await command("Emulation.clearDeviceMetricsOverride");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, screenWidth: 390, screenHeight: 844,
    positionX: 0, positionY: 0, deviceScaleFactor: 1, mobile: true,
  });
  const reloaded = new Promise((resolve) => { loadResolver = resolve; });
  await command("Page.reload", { ignoreCache: true });
  await reloaded;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await command("Runtime.evaluate", { expression: prepareExpression });
  await command("Runtime.evaluate", { expression: "window.scrollTo(0, 0); document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebarOverlay').classList.remove('open')" });
  const mobileMetrics = await command("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const sidebar = document.getElementById('sidebar').getBoundingClientRect();
      const main = document.querySelector('.main').getBoundingClientRect();
      return { innerWidth, scrollX, scrollWidth: document.documentElement.scrollWidth, sidebar: { left: sidebar.left, right: sidebar.right, width: sidebar.width }, mainLeft: main.left };
    })()`,
  });
  const mobile = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(path.join(outputDir, `${artifactPrefix}-mobile-dark.png`), mobile.data, "base64");

  await command("Runtime.evaluate", { expression: "window.toggleSidebar()" });
  await new Promise((resolve) => setTimeout(resolve, 220));
  const mobileMenu = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(path.join(outputDir, `${artifactPrefix}-mobile-menu-dark.png`), mobileMenu.data, "base64");

  socket.close();
  console.log(JSON.stringify({ status: "ok", outputDir, lightStyles: lightStyles.result.value, mobileMetrics: mobileMetrics.result.value }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
