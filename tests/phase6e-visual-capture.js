"use strict";

const fs = require("node:fs");
const path = require("node:path");

const [port = "9333", baseUrl = "http://127.0.0.1:8765"] = process.argv.slice(2);

async function main() {
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const tab = tabs.find((item) => item.type === "page");
  if (!tab) throw new Error("Nenhuma pagina disponivel para captura.");

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
  async function navigate(width, height, mobile) {
    await command("Emulation.clearDeviceMetricsOverride");
    await command("Emulation.setDeviceMetricsOverride", {
      width, height, screenWidth: width, screenHeight: height,
      positionX: 0, positionY: 0, deviceScaleFactor: 1, mobile,
    });
    const loaded = new Promise((resolve) => { loadResolver = resolve; });
    await command("Page.navigate", { url: `${baseUrl}/index.html` });
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  const prepare = `(() => {
    document.getElementById('loginScreen').style.setProperty('display', 'none', 'important');
    document.getElementById('app').style.setProperty('display', 'block', 'important');
    document.body.classList.remove('light');
    document.body.classList.add('dark');
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));
    document.getElementById('page-frequencia').classList.add('active');
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === 'frequencia'));
    document.querySelector('.topbar-title').textContent = 'Frequência';
    document.querySelector('.active-worksite h3').textContent = 'Maxxima Salvador';
    document.querySelector('.active-worksite p').textContent = 'Salvador — BA';
    document.querySelector('.user-info .u-name').textContent = 'Mariana Silva';
    document.querySelector('.user-info .u-role').textContent = 'Administradora • Ativo';
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
    APP_CTX.obraAtivaId = 'maxxima-salvador';
    DB.obra = { id: 'maxxima-salvador', nome: 'Maxxima Salvador', cidade: 'Salvador', estado: 'BA' };
    const terceiros = ['João Santos','Ana Beatriz Lima','Carlos Eduardo Souza','Juliana Rocha','Marcos Vinícius Alves','Rafael Oliveira','Fernanda Costa','Paulo Henrique'];
    const proprios = ['Camila Nascimento','Bruno Ferreira','Larissa Mendes','Diego Martins','Patrícia Almeida','Lucas Ribeiro'];
    DB.funcionarios = [
      ...terceiros.map((nome, index) => ({ id: 't.' + (index + 1), nome, tipo: 'Terceirizado', funcao: ['Pedreiro','Eletricista','Encanador','Técnica de Segurança'][index % 4], empresa: ['T&A Construção','Terra Forte Engenharia'][index % 2], admissao: '2026-01-05' })),
      ...proprios.map((nome, index) => ({ id: 'a' + (index + 1), nome, tipo: 'Novo Atacarejo', funcao: ['Engenheira Civil','Almoxarife','Assistente Administrativo'][index % 3], empresa: 'Maxxima Salvador', admissao: '2026-01-05' }))
    ];
    const pk = '2026-10';
    const statuses = ['Trabalhado','Feriado','Folga','FaltaInjustificada','FaltaJustificada','NaoContratado','Demitido'];
    const data = { feriados: { '12': 'Nossa Senhora Aparecida' }, terceirizados: {}, novoAtacarejo: {} };
    DB.funcionarios.forEach((func, row) => {
      const tipo = func.tipo === 'Terceirizado' ? 'terceirizados' : 'novoAtacarejo';
      data[tipo][func.id] = {};
      for (let day = 1; day <= 18; day += 1) data[tipo][func.id][String(day)] = statuses[(row + day - 1) % statuses.length];
    });
    data.novoAtacarejo.a1['4'] = { status: 'FaltaJustificada', obs: 'Consulta médica às 14h' };
    freqState.periodoKey = pk;
    freqState.data = { [pk]: data };
    freqState.initialized = true;
    const select = document.getElementById('freqMesSelect');
    select.innerHTML = '<option value="2026-10">Outubro 2026</option><option value="2026-09">Setembro 2026</option>';
    select.value = pk;
    freqRender();
    document.getElementById('freqSyncStatus').dataset.state = 'saved';
    document.getElementById('freqSyncStatus').textContent = '✓ Salvo';
    window.scrollTo(0, 0);
    return {
      cells: document.querySelectorAll('.freq-cell').length,
      listeners: [document.getElementById('freqWrapTerc').dataset.freqDelegated, document.getElementById('freqWrapAtac').dataset.freqDelegated],
      statuses: Array.from(new Set(Array.from(document.querySelectorAll('.freq-cell')).map((cell) => cell.dataset.status))).sort()
    };
  })()`;

  const outputDir = path.join(__dirname, "..", "artifacts");
  fs.mkdirSync(outputDir, { recursive: true });
  const capture = async (name) => {
    const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(outputDir, name), screenshot.data, "base64");
  };
  const inspect = `(() => {
    const wrap = document.getElementById('freqWrapTerc');
    return {
      innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      wrapClientWidth: wrap.clientWidth,
      wrapScrollWidth: wrap.scrollWidth,
      cells: document.querySelectorAll('.freq-cell').length,
      visibleStatuses: Array.from(new Set(Array.from(document.querySelectorAll('.freq-cell')).map((cell) => cell.dataset.status))).sort()
    };
  })()`;

  await command("Page.enable");
  await command("Runtime.enable");
  await navigate(1440, 900, false);
  const desktop = await command("Runtime.evaluate", { expression: prepare, returnByValue: true });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await capture("fase6e-frequencia-desktop-dark-statuses.png");
  await command("Runtime.evaluate", { expression: "document.body.classList.remove('dark'); document.body.classList.add('light')" });
  await capture("fase6e-frequencia-desktop-light.png");

  await navigate(390, 844, true);
  const mobile = await command("Runtime.evaluate", { expression: prepare, returnByValue: true });
  await command("Runtime.evaluate", { expression: "document.getElementById('freqWrapTerc').scrollLeft = 400" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await capture("fase6e-frequencia-mobile-dark.png");
  const mobileMetrics = await command("Runtime.evaluate", { expression: inspect, returnByValue: true });

  socket.close();
  console.log(JSON.stringify({
    status: "ok",
    outputDir,
    desktop: desktop.result.value,
    mobile: mobile.result.value,
    mobileMetrics: mobileMetrics.result.value,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
