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
    window.canEditEmpresas = () => true;
    const categories = [
      { id: 'civil', nome: 'Civil', nomeNormalizado: 'CIVIL', ordem: 1, ativa: true, createdAt: '2026-01-01' },
      { id: 'instalacoes', nome: 'Instalações', nomeNormalizado: 'INSTALACOES', ordem: 2, ativa: true, createdAt: '2026-01-01' },
      { id: 'estrutura', nome: 'Estrutura / Metálica', nomeNormalizado: 'ESTRUTURA_METALICA', ordem: 3, ativa: true, createdAt: '2026-01-01' },
      { id: 'paisagismo', nome: 'Paisagismo', nomeNormalizado: 'PAISAGISMO', ordem: 4, ativa: false, createdAt: '2026-01-01' },
      { id: 'outros', nome: 'Outros', nomeNormalizado: 'OUTROS', ordem: 5, ativa: true, createdAt: '2026-01-01' }
    ];
    DB.empresas = [
      { id: 'e1', nome: 'T&A Construção', cnpj: '11.222.333/0001-44', resp: 'Carlos Mendes', status: 'ativa', dataInicioObra: '2026-01-08', dataFimObra: null, categoriaEfetivoId: 'civil', categoriaEfetivo: 'CIVIL', docs: { pgr: { status: 'Conforme' }, pcmso: { status: 'Conforme' }, art: { status: 'Pendente' } } },
      { id: 'e2', nome: 'Terra Forte', cnpj: '22.333.444/0001-55', resp: 'Ana Ribeiro', status: 'ativa', dataInicioObra: '2026-02-15', dataFimObra: null, categoriaEfetivoId: 'estrutura', categoriaEfetivo: 'ESTRUTURA_METALICA', docs: { pgr: { status: 'Conforme' }, pcmso: { status: 'Não se aplica' }, art: { status: 'Conforme' } } },
      { id: 'e3', nome: 'Base Engenharia', cnpj: '33.444.555/0001-66', resp: 'Paulo Lima', status: 'ativa', dataInicioObra: '2026-03-10', dataFimObra: null, categoriaEfetivoId: 'paisagismo', categoriaEfetivo: 'PAISAGISMO', docs: { pgr: { status: 'Pendente' }, pcmso: { status: 'Pendente' }, art: { status: 'Não Conforme' } } },
      { id: 'e4', nome: 'Engenharia Beta', cnpj: '44.555.666/0001-77', resp: 'Marina Costa', status: 'inativa', dataInicioObra: '2025-08-01', dataFimObra: '2026-07-31', categoriaEfetivoId: 'outros', categoriaEfetivo: 'OUTROS', docs: { pgr: { status: 'Conforme' }, pcmso: { status: 'Conforme' }, art: { status: 'Conforme' } } },
      { id: 'e5', nome: 'Cadastro Histórico', cnpj: '55.666.777/0001-88', resp: '', status: 'ativa', dataInicioObra: null, dataFimObra: null, docs: {} }
    ];
    DB.funcionarios = [
      { id: 'f1', empresaId: 'e1', empresa: 'T&A Construção' },
      { id: 'f2', empresaId: 'e1', empresa: 'T&A Construção' },
      { id: 'f3', empresa: 'Terra Forte' },
      { id: 'f4', empresaId: 'e3', empresa: 'Base Engenharia' },
      { id: 'f5', empresaId: 'e3', empresa: 'Base Engenharia' },
      { id: 'f6', empresaId: 'e3', empresa: 'Base Engenharia' }
    ];
    applyEfetivoCategoriesPayload({ exists: true, categorias: categories });
    renderEmpresas();
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));
    document.getElementById('page-empresas').classList.add('active');
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === 'empresas'));
    document.querySelector('.topbar-title').textContent = 'Empresas';
    document.querySelector('.active-worksite h3').textContent = 'Maxxima Salvador';
    document.querySelector('.active-worksite p').textContent = 'Salvador — BA';
    document.querySelector('.user-info .u-name').textContent = 'Mariana Silva';
    document.querySelector('.user-info .u-role').textContent = 'Administradora • Ativo';
    document.querySelectorAll('#page-empresas .edit-btn, #page-empresas .delete-btn, #page-empresas .empresa-lifecycle-action').forEach((button) => button.style.removeProperty('display'));
    document.getElementById('btnNovaEmpresa').style.removeProperty('display');
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
    window.scrollTo(0, 0);
    return { rows: document.querySelectorAll('.companies-table tbody tr').length, categories: DB.efetivoCategorias.length };
  })()`;

  const outputDir = path.join(__dirname, "..", "artifacts");
  fs.mkdirSync(outputDir, { recursive: true });
  const capture = async (name) => {
    const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(outputDir, name), screenshot.data, "base64");
  };

  await command("Page.enable");
  await command("Runtime.enable");
  await navigate(1440, 900, false);
  const desktopState = await command("Runtime.evaluate", { expression: prepare, returnByValue: true });
  await capture("fase6d-empresas-desktop-dark.png");

  await command("Runtime.evaluate", { expression: "openEmpresaModal('e1')" });
  await new Promise((resolve) => setTimeout(resolve, 220));
  await capture("fase6d-empresa-modal-desktop-dark.png");

  await command("Runtime.evaluate", { expression: "closeModal('modalEmpresa'); openEfetivoCategoriesModal()" });
  await new Promise((resolve) => setTimeout(resolve, 220));
  const categoryState = await command("Runtime.evaluate", {
    expression: `(() => ({ rows: document.querySelectorAll('.efetivo-category-row').length, delegated: document.getElementById('efetivo-category-list').dataset.actionsBound, perRowHandlers: document.querySelectorAll('.efetivo-category-row [onclick]').length }))()`,
    returnByValue: true,
  });
  await capture("fase6d-categorias-desktop-dark.png");

  const viewerState = await command("Runtime.evaluate", {
    expression: `(() => {
      window.canEditEmpresas = () => false;
      renderEfetivoCategoryManager();
      const state = {
        mutationControls: document.querySelectorAll('#efetivo-category-list [data-category-action]').length,
        readonlyInputs: document.querySelectorAll('#efetivo-category-list input[readonly]').length,
        readonlyNoteVisible: !document.getElementById('efetivo-category-readonly').hidden
      };
      window.canEditEmpresas = () => true;
      renderEfetivoCategoryManager();
      return state;
    })()`,
    returnByValue: true,
  });

  await command("Runtime.evaluate", { expression: "closeModal('modalEfetivoCategorias'); document.body.classList.remove('dark'); document.body.classList.add('light')" });
  await new Promise((resolve) => setTimeout(resolve, 180));
  await capture("fase6d-empresas-desktop-light.png");

  await navigate(390, 844, true);
  const mobileState = await command("Runtime.evaluate", { expression: prepare, returnByValue: true });
  await capture("fase6d-empresas-mobile-dark.png");
  const metrics = await command("Runtime.evaluate", {
    expression: `(() => ({ innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, tableScrollWidth: document.querySelector('.companies-table-wrap').scrollWidth, tableClientWidth: document.querySelector('.companies-table-wrap').clientWidth }))()`,
    returnByValue: true,
  });
  await command("Runtime.evaluate", { expression: "openEfetivoCategoriesModal()" });
  await new Promise((resolve) => setTimeout(resolve, 220));
  await capture("fase6d-categorias-mobile-dark.png");

  socket.close();
  console.log(JSON.stringify({
    status: "ok",
    outputDir,
    desktopState: desktopState.result.value,
    categoryState: categoryState.result.value,
    viewerState: viewerState.result.value,
    mobileState: mobileState.result.value,
    metrics: metrics.result.value,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
