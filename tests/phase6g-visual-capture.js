"use strict";

const fs = require("node:fs");
const path = require("node:path");

const [port = "9334", baseUrl = "http://127.0.0.1:8765"] = process.argv.slice(2);

async function main() {
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const tab = tabs.find((item) => item.type === "page");
  if (!tab) throw new Error("Nenhuma pagina disponivel para captura.");

  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  const pending = new Map();
  const browserIssues = [];
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
    } else if (message.method === "Runtime.exceptionThrown") {
      browserIssues.push(message.params.exceptionDetails.text || "Runtime exception");
    } else if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
      browserIssues.push(message.params.entry.text);
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
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
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
    await new Promise((resolve) => setTimeout(resolve, 900));
  }

  const outputDir = path.join(__dirname, "..", "artifacts");
  fs.mkdirSync(outputDir, { recursive: true });
  const capture = async (name) => {
    const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(outputDir, name), screenshot.data, "base64");
  };
  const viewportMetrics = () => evaluate(`(() => ({
    innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    activePage: document.querySelector('.page.active')?.id || '',
    modalOpen: document.getElementById('modalObra')?.classList.contains('open') || false
  }))()`);

  const showLogin = `(() => {
    document.body.classList.remove('light');
    document.body.classList.add('dark');
    document.getElementById('app').style.setProperty('display', 'none', 'important');
    document.getElementById('loginScreen').style.setProperty('display', 'grid', 'important');
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
    window.scrollTo(0, 0);
  })()`;

  const prepareApp = `(() => {
    document.getElementById('loginScreen').style.setProperty('display', 'none', 'important');
    document.getElementById('app').style.setProperty('display', 'block', 'important');
    document.body.classList.remove('light');
    document.body.classList.add('dark');
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('open');
    APP_CTX.obraAtivaId = 'maxxima-salvador';
    DB.obra = {
      id: 'maxxima-salvador', cnpj: '12.345.678/0001-90', nome: 'Maxxima Salvador',
      logradouro: 'Avenida Paralela', numero: '1500', cep: '41.000-000', bairro: 'Imbui',
      municipio: 'Salvador', uf: 'BA',
      equipeEng: [{ nome: 'Mariana Silva', funcao: 'Engenheiro Civil', crea: '123456-7/BA', telefone: '(71) 99999-1200', empresa: 'Maxxima Engenharia' }],
      equipeSST: [{ nome: 'Rafael Souza', funcao: 'Tecnico de Seguranca', telefone: '(71) 98888-4433', departamento: 'Campo', mte: 'BA-009876' }]
    };
    document.querySelector('.active-worksite h3').textContent = 'Maxxima Salvador';
    document.querySelector('.active-worksite p').textContent = 'Salvador - BA';
    document.querySelector('.user-info .u-name').textContent = 'Mariana Silva';
    document.querySelector('.user-info .u-role').textContent = 'Administradora';
    window.scrollTo(0, 0);
  })()`;

  const showPage = (id, title) => `(() => {
    document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === 'page-${id}'));
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === '${id}'));
    document.querySelector('.topbar-title').textContent = '${title}';
    window.scrollTo(0, 0);
  })()`;

  await command("Page.enable");
  await command("Runtime.enable");
  await command("Log.enable");

  await navigate(1440, 900, false);
  await evaluate(showLogin);
  await capture("fase6g-login-desktop-dark.png");
  const loginDesktop = await viewportMetrics();

  await navigate(390, 844, true);
  await evaluate(showLogin);
  await capture("fase6g-login-mobile-dark.png");
  const loginMobile = await viewportMetrics();

  await navigate(1440, 900, false);
  await evaluate(prepareApp);
  await evaluate("window.canEditObra = () => true; window.canViewCurrentObra = () => true; openObraModal();");
  await capture("fase6g-obra-modal-desktop-dark.png");
  await evaluate("document.body.classList.remove('dark'); document.body.classList.add('light');");
  await new Promise((resolve) => setTimeout(resolve, 350));
  await capture("fase6g-obra-modal-desktop-light.png");
  const obraDesktop = await viewportMetrics();

  await navigate(390, 844, true);
  await evaluate(prepareApp);
  await evaluate("window.canEditObra = () => true; window.canViewCurrentObra = () => true; openObraModal();");
  await capture("fase6g-obra-modal-mobile-dark.png");
  const obraMobile = await viewportMetrics();

  const prepareAta = `(() => {
    computeStatus = () => 'conforme';
    DB.funcionarios = [
      { id:'t1', nome:'Joao Santos', tipo:'Terceirizado', empresa:'Terra Forte Engenharia', funcao:'Pedreiro' },
      { id:'t2', nome:'Ana Beatriz Lima', tipo:'Terceirizado', empresa:'T&A Construcao', funcao:'Eletricista' },
      { id:'t3', nome:'Carlos Eduardo Souza', tipo:'Terceirizado', empresa:'T&A Construcao', funcao:'Encanador' },
      { id:'t4', nome:'Juliana Rocha', tipo:'Terceirizado', empresa:'Terra Forte Engenharia', funcao:'Tecnica de Seguranca' },
      { id:'a1', nome:'Camila Nascimento', tipo:'Novo Atacarejo', empresa:'Maxxima Salvador', funcao:'Engenheira Civil' }
    ];
    document.getElementById('ataDateTerc').value = '2026-10-07';
    renderAta('terceirizado');
  })()`;

  await navigate(1440, 900, false);
  await evaluate(prepareApp);
  await evaluate(showPage("ata-terc", "Ata de Terceiros"));
  await evaluate(prepareAta);
  await capture("fase6g-ata-terceiros-desktop-dark.png");
  await evaluate("document.body.classList.remove('dark'); document.body.classList.add('light');");
  await new Promise((resolve) => setTimeout(resolve, 350));
  await capture("fase6g-ata-terceiros-desktop-light.png");
  const ataDesktop = await viewportMetrics();

  await navigate(390, 844, true);
  await evaluate(prepareApp);
  await evaluate(showPage("ata-terc", "Ata de Terceiros"));
  await evaluate(prepareAta);
  await capture("fase6g-ata-terceiros-mobile-dark.png");
  const ataMobile = await viewportMetrics();

  const prepareAdmin = `(() => {
    window.currentUserProfile = { id:'admin-1', email:'admin@maxxima.com.br', role:'admin', status:'active', acessos:{ 'maxxima-salvador': { enabled:true, role:'admin' } } };
    window.canManageUsers = () => true;
    window.appUsers = [
      { id:'u-admin', email:'admin@maxxima.com.br', role:'admin', status:'active', acessos:{ 'maxxima-salvador':{ enabled:true, role:'admin' } } },
      { id:'u-edit', email:'engenharia@maxxima.com.br', role:'editor', status:'active', acessos:{ 'maxxima-salvador':{ enabled:true, role:'editor' } } },
      { id:'u-view', email:'consulta@maxxima.com.br', role:'viewer', status:'blocked', acessos:{ 'maxxima-salvador':{ enabled:false, role:'viewer' } } }
    ];
    renderAdminUsers();
    document.getElementById('adminBackupSection').style.display = '';
  })()`;

  await navigate(1440, 900, false);
  await evaluate(prepareApp);
  await evaluate(showPage("admin", "Administracao"));
  await evaluate(prepareAdmin);
  await capture("fase6g-admin-desktop-dark.png");
  await evaluate("document.body.classList.remove('dark'); document.body.classList.add('light');");
  await new Promise((resolve) => setTimeout(resolve, 350));
  await capture("fase6g-admin-desktop-light.png");
  const adminDesktop = await viewportMetrics();

  await navigate(390, 844, true);
  await evaluate(prepareApp);
  await evaluate(showPage("admin", "Administracao"));
  await evaluate(prepareAdmin);
  await capture("fase6g-admin-mobile-dark.png");
  const adminMobile = await viewportMetrics();

  socket.close();
  console.log(JSON.stringify({
    status: "ok", outputDir, browserIssues,
    metrics: { loginDesktop, loginMobile, obraDesktop, obraMobile, ataDesktop, ataMobile, adminDesktop, adminMobile },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
