"use strict";

const fs = require("node:fs");
const path = require("node:path");

const [port = "9333", baseUrl = "http://127.0.0.1:8765"] = process.argv.slice(2);

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

  async function navigate(width, height, mobile) {
    await command("Emulation.clearDeviceMetricsOverride");
    await command("Emulation.setDeviceMetricsOverride", {
      width, height, screenWidth: width, screenHeight: height,
      positionX: 0, positionY: 0, deviceScaleFactor: 1, mobile,
    });
    const loaded = new Promise((resolve) => { loadResolver = resolve; });
    await command("Page.navigate", { url: `${baseUrl}/index.html` });
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, 1400));
  }

  const prepare = `(() => {
    document.getElementById('loginScreen').style.setProperty('display', 'none', 'important');
    document.getElementById('app').style.setProperty('display', 'block', 'important');
    document.body.classList.remove('light');
    document.body.classList.add('dark');
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));
    document.getElementById('page-terceirizados').classList.add('active');
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === 'terceirizados'));
    document.querySelector('.topbar-title').textContent = 'Funcionários Terceirizados';
    document.querySelector('.active-worksite h3').textContent = 'Maxxima Salvador';
    document.querySelector('.active-worksite p').textContent = 'Salvador — BA';
    document.querySelector('.user-info .u-name').textContent = 'Mariana Silva';
    document.querySelector('.user-info .u-role').textContent = 'Administradora • Ativo';
    const required = getRequiredDocs('Terceirizado');
    const docsFor = (status, conditional) => {
      const docs = {};
      required.forEach((name) => { docs[makeKey(name)] = { docName: name, status: 'Conforme', fileName: name + '.pdf' }; });
      if(status === 'pendente') docs[makeKey(required[0])] = { docName: required[0], status: 'Pendente', deadline: '2026-10-09T12:00:00.000Z' };
      if(status === 'irregular') docs[makeKey(required[0])] = { docName: required[0], status: 'Não Conforme' };
      if(conditional) {
        docs.NR10 = { docName: 'NR10', status: conditional === 'na' ? 'Não se aplica' : 'Conforme', fileName: conditional === 'na' ? null : 'nr10.pdf' };
        docs.NR11 = { docName: 'NR11', status: conditional === 'expired' ? 'Pendente' : 'Não se aplica', deadline: conditional === 'expired' ? '2026-09-30T12:00:00.000Z' : null };
      }
      return docs;
    };
    DB.empresas = [{ id: 'emp-1', nome: 'T&A Construção', tipo: 'Terceirizada', status: 'Ativa' }];
    DB.funcionarios = [
      { id: 'f1', nome: 'Tiago Santos de Jesus', cpf: '123.456.789-00', empresa: 'T&A Construção', empresaId: 'emp-1', funcao: 'Montador', tipo: 'Terceirizado', docs: docsFor('conforme', 'ok') },
      { id: 'f2', nome: 'Gilberto Sousa dos Santos', cpf: '987.654.321-00', empresa: 'T&A Construção', empresaId: 'emp-1', funcao: 'Montador', tipo: 'Terceirizado', docs: docsFor('pendente', 'na') },
      { id: 'f3', nome: 'Ana Carla Oliveira', cpf: '456.789.123-00', empresa: 'Terra Forte', empresaId: 'emp-2', funcao: 'Eletricista', tipo: 'Terceirizado', docs: docsFor('irregular', 'expired') },
      { id: 'f4', nome: 'Rafael Alves Pereira', cpf: '741.852.963-00', empresa: 'Base Engenharia', empresaId: 'emp-3', funcao: 'Operador', tipo: 'Terceirizado', docs: docsFor('conforme', 'na') },
      { id: 'f5', nome: 'Juliana Pereira', cpf: '369.258.147-00', empresa: 'Engenharia Beta', empresaId: 'emp-4', funcao: 'Servente', tipo: 'Terceirizado', docs: docsFor('pendente', null) }
    ];
    filters.terceirizados = 'todos';
    renderTerceirizados();
    document.getElementById('btnNovoTerceirizado').style.removeProperty('display');
    document.querySelectorAll('#tercTable .edit-btn, #tercTable .delete-btn').forEach((button) => button.style.removeProperty('display'));
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
    window.scrollTo(0, 0);
    return { rows: document.querySelectorAll('#tercTable tr').length, statusBadges: document.querySelectorAll('#tercTable .badge-status').length };
  })()`;

  const outputDir = path.join(__dirname, "..", "artifacts");
  fs.mkdirSync(outputDir, { recursive: true });
  const capture = async (name) => {
    const shot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(outputDir, name), shot.data, "base64");
  };

  await command("Page.enable");
  await command("Runtime.enable");
  await navigate(1440, 900, false);
  const desktopState = await command("Runtime.evaluate", { expression: prepare, returnByValue: true });
  await capture("fase6c-funcionarios-desktop-dark.png");

  await command("Runtime.evaluate", { expression: `(() => {
    const required = getRequiredDocs('Novo Atacarejo');
    DB.funcionarios = DB.funcionarios.map((funcionario, index) => {
      const docs = {};
      required.forEach((name) => { docs[makeKey(name)] = { docName: name, status: 'Conforme', fileName: name + '.pdf' }; });
      if(index === 1) docs[makeKey(required[0])] = { docName: required[0], status: 'Pendente', deadline: '2026-10-09T12:00:00.000Z' };
      if(index === 2) docs[makeKey(required[0])] = { docName: required[0], status: 'Não Conforme' };
      if(index === 3) docs.NR10 = { docName: 'NR10', status: 'Não se aplica' };
      if(index === 4) docs.NR11 = { docName: 'NR11', status: 'Pendente', deadline: '2026-09-30T12:00:00.000Z' };
      return { ...funcionario, tipo: 'Novo Atacarejo', empresa: 'Maxxima Salvador', empresaId: 'obra-1', docs };
    });
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));
    document.getElementById('page-atacarejo').classList.add('active');
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === 'atacarejo'));
    document.querySelector('.topbar-title').textContent = 'Funcionários Maxxima Salvador';
    renderAtacarejo();
    document.getElementById('btnNovoAtacarejo').style.removeProperty('display');
    window.scrollTo(0, 0);
  })()` });
  await capture("fase6c-funcionarios-obra-desktop-dark.png");
  await command("Runtime.evaluate", { expression: prepare });

  await command("Runtime.evaluate", { expression: `(() => {
    DB.currentEditId = null;
    DB.tempDocs = {};
    document.getElementById('f-tipo').value = 'Terceirizado';
    document.getElementById('f-empresa').innerHTML = '<option value="emp-1" data-empresa-id="emp-1" data-empresa-nome="T&A Construção" selected>T&A Construção</option>';
    document.getElementById('docsFields').innerHTML = buildDocFields('Terceirizado');
    document.getElementById('trainFields').innerHTML = buildTrainFields('Terceirizado');
    initStatusDropdowns(document.getElementById('modalCadastro'));
    showTab('tab-dados', document.querySelector('#modalCadastro .tab-btn'));
    openModal('modalCadastro');
  })()` });
  await new Promise((resolve) => setTimeout(resolve, 250));
  await capture("fase6c-funcionario-modal-desktop-dark.png");

  await command("Runtime.evaluate", { expression: "closeModal('modalCadastro'); document.body.classList.remove('dark'); document.body.classList.add('light')" });
  await new Promise((resolve) => setTimeout(resolve, 180));
  await capture("fase6c-funcionarios-desktop-light.png");

  await navigate(390, 844, true);
  const mobileState = await command("Runtime.evaluate", { expression: prepare, returnByValue: true });
  await capture("fase6c-funcionarios-mobile-dark.png");
  const metrics = await command("Runtime.evaluate", {
    expression: `(() => ({ innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, tableScrollWidth: document.querySelector('.employee-table-wrap').scrollWidth, tableClientWidth: document.querySelector('.employee-table-wrap').clientWidth }))()`,
    returnByValue: true,
  });

  await command("Runtime.evaluate", { expression: `(() => {
    document.getElementById('f-tipo').value = 'Novo Atacarejo';
    document.getElementById('docsFields').innerHTML = buildDocFields('Novo Atacarejo');
    document.getElementById('trainFields').innerHTML = buildTrainFields('Novo Atacarejo');
    initStatusDropdowns(document.getElementById('modalCadastro'));
    showTab('tab-train', document.querySelectorAll('#modalCadastro .tab-btn')[2]);
    openModal('modalCadastro');
  })()` });
  await new Promise((resolve) => setTimeout(resolve, 250));
  await capture("fase6c-funcionario-modal-mobile-dark.png");

  socket.close();
  console.log(JSON.stringify({
    status: "ok",
    outputDir,
    desktopState: desktopState.result.value,
    mobileState: mobileState.result.value,
    metrics: metrics.result.value,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
