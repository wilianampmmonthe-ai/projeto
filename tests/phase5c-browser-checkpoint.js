"use strict";

const assert = require("node:assert/strict");

const [port = "9333", baseUrl = "http://127.0.0.1:8765"] = process.argv.slice(2);

async function main() {
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const tab = tabs.find((item) => item.type === "page");
  if (!tab) throw new Error("Nenhuma página disponível para o checkpoint.");
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  const pending = new Map();
  const consoleEntries = [];
  const exceptions = [];
  const httpErrors = [];
  let sequence = 0;
  let loadResolver = null;

  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
      return;
    }
    if (message.method === "Page.loadEventFired" && loadResolver) {
      const resolve = loadResolver;
      loadResolver = null;
      resolve();
    }
    if (message.method === "Runtime.consoleAPICalled") {
      consoleEntries.push({
        type: message.params.type,
        text: message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "),
      });
    }
    if (message.method === "Runtime.exceptionThrown") {
      exceptions.push(message.params.exceptionDetails.text || message.params.exceptionDetails.exception?.description || "Erro sem descrição");
    }
    if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
      httpErrors.push({ status: message.params.response.status, url: message.params.response.url });
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
  async function navigate(pathname) {
    const loaded = new Promise((resolve) => { loadResolver = resolve; });
    await command("Page.navigate", { url: `${baseUrl}/${pathname}` });
    await loaded;
  }
  async function evaluate(expression) {
    const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  }
  async function benchmark(pathname) {
    await navigate(pathname);
    return evaluate(`(async () => {
      const deadline = Date.now() + 10000;
      while (document.getElementById('result')?.textContent === 'running' && Date.now() < deadline) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return JSON.parse(document.getElementById('result').textContent);
    })()`);
  }

  await command("Runtime.enable");
  await command("Page.enable");
  await command("Network.enable");
  await command("Network.setCacheDisabled", { cacheDisabled: true });

  const frequency = await benchmark("tests/phase5b1-frequency-benchmark.html");
  const lifecycle = await benchmark("tests/phase5b2-render-lifecycle-benchmark.html");

  consoleEntries.length = 0;
  exceptions.length = 0;
  httpErrors.length = 0;
  await navigate("index.html");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const integrated = await evaluate(`(async () => {
    const scriptCount = (name) => document.querySelectorAll('script[data-app-dependency="' + name + '"]').length;
    const initial = {
      globals: {
        jsPDF: Boolean(window.jspdf?.jsPDF), XLSX: Boolean(window.XLSX), Chart: Boolean(window.Chart),
        efetivo: typeof window.efetivoInit === 'function', storage: typeof window.firebase?.storage === 'function'
      },
      scripts: Array.from(document.scripts, (script) => script.src).filter(Boolean)
    };

    // O checkpoint de navegação não depende de credenciais nem grava dados remotos.
    window.listenEfetivo = (_period, callback) => { callback(null); return () => {}; };
    window.loadFrequencia = async () => null;
    window.getLatestFrequenciaPeriodoKey = async () => null;
    window.syncFrequenciaListener = () => {};
    window.appRenderLifecycle.resetCounters();
    const open = async (page) => {
      window.showPage(page, document.querySelector('[data-page="' + page + '"]'));
      await new Promise((resolve) => setTimeout(resolve, page === 'efetivo' ? 250 : 25));
    };
    await open('dashboard');
    await open('terceirizados');
    await open('atacarejo');
    await open('empresas');
    window.openEfetivoCategoriesModal?.();
    window.closeModal?.('modalEfetivoCategorias');
    await open('frequencia');
    await open('efetivo');
    await open('dashboard');
    await open('frequencia');
    await open('efetivo');

    let pdfActions = 0;
    const pdfOperation = () => {
      const doc = new window.jspdf.jsPDF();
      doc.text('Checkpoint', 10, 10);
      pdfActions += 1;
      return doc.output('arraybuffer').byteLength;
    };
    const pdfResults = await Promise.all([
      window.appDependencies.runWhenReady('jspdf', {}, pdfOperation),
      window.appDependencies.runWhenReady('jspdf', {}, pdfOperation)
    ]);
    let xlsxActions = 0;
    const xlsxBytes = await window.appDependencies.runWhenReady('xlsx', {}, () => {
      const workbook = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(workbook, window.XLSX.utils.aoa_to_sheet([['Checkpoint'], [1]]), 'Base');
      xlsxActions += 1;
      return window.XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }).byteLength;
    });
    await window.appDependencies.loadFirebaseStorage();

    return {
      initial,
      activePage: document.querySelector('.page.active')?.id,
      counters: window.appRenderLifecycle.counters(),
      dirty: window.appRenderLifecycle.snapshot(),
      lazyScripts: {
        jspdf: scriptCount('jspdf'), xlsx: scriptCount('xlsx'), chartjs: scriptCount('chartjs'),
        efetivo: scriptCount('efetivo'), firebaseStorage: scriptCount('firebaseStorage')
      },
      operations: { pdfActions, pdfBytes: pdfResults, xlsxActions, xlsxBytes },
      globalsAfter: {
        jsPDF: Boolean(window.jspdf?.jsPDF), XLSX: Boolean(window.XLSX), Chart: Boolean(window.Chart),
        efetivo: typeof window.efetivoInit === 'function', storage: typeof window.firebase?.storage === 'function'
      }
    };
  })()`);

  socket.close();

  assert.equal(frequency.cardinality.employees, 121);
  assert.equal(frequency.cardinality.cells, 3751);
  assert.equal(frequency.fullRendersPerCell, 0);
  assert.equal(frequency.delegatedListeners, 2);
  assert.ok(frequency.clickToDomP95Ms < 10, `clique → DOM p95 excedeu 10 ms: ${frequency.clickToDomP95Ms}`);
  assert.ok(frequency.clickToPaintMs < 50, `clique → frame excedeu 50 ms: ${frequency.clickToPaintMs}`);
  assert.equal(lifecycle.F.after.renders, 10);
  assert.equal(lifecycle.C.after.renders, 0);
  assert.equal(lifecycle.D.after.renders, 0);
  Object.entries(integrated.initial.globals).forEach(([name, value]) => assert.equal(value, false, `${name} apareceu no startup`));
  Object.entries(integrated.lazyScripts).forEach(([name, count]) => assert.equal(count, 1, `${name} foi carregado ${count} vezes`));
  Object.entries(integrated.globalsAfter).forEach(([name, value]) => assert.equal(value, true, `${name} não carregou sob demanda`));
  assert.equal(integrated.activePage, "efetivo-page");
  assert.equal(integrated.operations.pdfActions, 2);
  assert.ok(integrated.operations.pdfBytes.every((size) => size > 500));
  assert.equal(integrated.operations.xlsxActions, 1);
  assert.ok(integrated.operations.xlsxBytes > 1000);
  assert.deepEqual(exceptions, [], `Exceções no browser: ${exceptions.join(" | ")}`);
  assert.deepEqual(httpErrors, [], `HTTP 4xx/5xx: ${JSON.stringify(httpErrors)}`);
  const appConsoleErrors = consoleEntries.filter((entry) => entry.type === "error");
  assert.deepEqual(appConsoleErrors, [], `console.error: ${JSON.stringify(appConsoleErrors)}`);

  const output = {
    status: "ok",
    frequency,
    lifecycle,
    integrated,
    console: {
      error: appConsoleErrors.length,
      warning: consoleEntries.filter((entry) => entry.type === "warning").map((entry) => entry.text),
      info: consoleEntries.filter((entry) => !["error", "warning"].includes(entry.type)).length,
    },
    network: { httpErrors: httpErrors.length },
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
