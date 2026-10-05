const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createDependencyLoader } = require("../js/utils/dependency-loader.js");

function fakeDocument() {
  const scripts = [];
  const makeScript = () => {
    const listeners = new Map();
    return {
      dataset: {},
      addEventListener(type, callback) { listeners.set(type, callback); },
      removeEventListener(type, callback) {
        if (listeners.get(type) === callback) listeners.delete(type);
      },
      dispatch(type) { listeners.get(type)?.(); },
      closest() { return this; },
    };
  };
  const parent = {
    appendChild(script) {
      script.parentNode = parent;
      scripts.push(script);
    },
    removeChild(script) {
      const index = scripts.indexOf(script);
      if (index >= 0) scripts.splice(index, 1);
      script.parentNode = null;
    },
  };
  return {
    scripts,
    head: parent,
    createElement: makeScript,
    querySelector(selector) {
      const name = /data-app-dependency="([^"]+)"/.exec(selector)?.[1];
      return scripts.find((script) => script.dataset.appDependency === name) || null;
    },
  };
}

async function run() {
  const scope = {};
  const document = fakeDocument();
  const loader = createDependencyLoader({
    scope,
    document,
    timeoutMs: 1000,
    dependencies: {
      example: { src: "example.js", test: (target) => Boolean(target.example) },
    },
  });

  const first = loader.load("example");
  const concurrent = loader.load("example");
  assert.equal(first, concurrent, "chamadas concorrentes devem compartilhar a mesma Promise");
  assert.equal(document.scripts.length, 1, "somente um script deve ser injetado");
  assert.equal(loader.getState("example"), "loading");

  scope.example = { ready: true };
  document.scripts[0].dispatch("load");
  await Promise.all([first, concurrent]);
  assert.equal(loader.getState("example"), "loaded");
  await loader.load("example");
  assert.equal(document.scripts.length, 1, "reutilização não deve reinjetar o script");

  delete scope.example;
  document.scripts.splice(0);
  const failed = loader.load("example");
  document.scripts[0].dispatch("error");
  await assert.rejects(failed, /Não foi possível carregar example/);
  assert.equal(document.scripts.length, 0, "script com falha deve ser removido para permitir retry");
  assert.equal(loader.getState("example"), "idle");

  const retry = loader.load("example");
  assert.equal(document.scripts.length, 1, "retry deve criar uma nova tentativa");
  scope.example = { ready: true };
  document.scripts[0].dispatch("load");
  await retry;

  delete scope.example;
  document.scripts.splice(0);
  const button = { disabled: false, innerHTML: "Exportar", textContent: "Exportar", closest() { return this; } };
  let actionCalls = 0;
  const automatic = loader.runWhenReady("example", { button, loadingText: "Carregando..." }, () => {
    actionCalls += 1;
    return "feito";
  });
  assert.equal(button.disabled, true, "botão deve indicar carregamento");
  assert.equal(button.textContent, "Carregando...");
  scope.example = { ready: true };
  document.scripts[0].dispatch("load");
  assert.equal(await automatic, "feito", "a ação original deve continuar no primeiro clique");
  assert.equal(actionCalls, 1);
  assert.equal(button.disabled, false);
  assert.equal(button.innerHTML, "Exportar");

  for (const name of ["jspdf", "xlsx", "chartjs"]) {
    const isolatedScope = { applicationStillUsable: true };
    const isolatedDocument = fakeDocument();
    const isolatedLoader = createDependencyLoader({ scope: isolatedScope, document: isolatedDocument, timeoutMs: 1000 });
    const attempt = isolatedLoader.load(name);
    isolatedDocument.scripts[0].dispatch("error");
    await assert.rejects(attempt, new RegExp(`carregar ${name}`));
    assert.equal(isolatedScope.applicationStillUsable, true, `falha de ${name} não deve afetar a aplicação`);
    assert.equal(isolatedLoader.getState(name), "idle", `${name} deve aceitar retry depois da falha`);
  }

  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.doesNotMatch(html, /<script[^>]+jspdf\.umd/i, "jsPDF não deve estar no HTML inicial");
  assert.doesNotMatch(html, /<script[^>]+xlsx\.full/i, "XLSX não deve estar no HTML inicial");
  assert.doesNotMatch(html, /<script[^>]+chart\.umd/i, "Chart.js não deve estar no HTML inicial");
  assert.doesNotMatch(html, /<script[^>]+firebase-storage-compat/i, "Storage não deve estar no HTML inicial");
  assert.doesNotMatch(html, /<script[^>]+modules\/efetivo\.js/i, "Efetivo não deve estar no HTML inicial");
  assert.match(html, /firebase-database-compat\.js/, "Realtime Database legado deve permanecer carregado");
  assert.match(html, /utils\/dependency-loader\.js/, "loader central deve permanecer no startup");

  console.log("FASE 5B.3: concorrência, reutilização, primeiro clique, retry e falhas isoladas passaram.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
