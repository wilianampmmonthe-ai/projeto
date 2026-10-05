"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { MODULES, DEPENDENCIES, createLifecycle } = require("../js/modules/render-lifecycle.js");

function createHarness(initialActive) {
  let active = initialActive;
  const calls = Object.fromEntries(MODULES.map((module) => [module, 0]));
  const lifecycle = createLifecycle({ isActive: (module) => module === active });
  MODULES.forEach((module) => lifecycle.register(module, () => { calls[module] += 1; }));
  return { lifecycle, calls, setActive: (module) => { active = module; } };
}

function run() {
  assert.deepEqual(DEPENDENCIES.funcionarios, [
    "dashboard", "terceirizados", "atacarejo", "empresas", "frequencia", "efetivo", "ata-terc", "ata-atac",
  ]);

  const hiddenSnapshot = createHarness("empresas");
  const result = hiddenSnapshot.lifecycle.notify("funcionarios");
  assert.deepEqual(result.rendered, ["empresas"], "snapshot renderiza somente consumidor visível");
  assert.equal(hiddenSnapshot.calls.dashboard, 0, "Dashboard oculto não renderiza");
  assert.equal(hiddenSnapshot.calls.terceirizados, 0, "Funcionários oculto não renderiza");
  assert.equal(hiddenSnapshot.calls.frequencia, 0, "Frequência oculta não sofre full render");
  assert.equal(hiddenSnapshot.lifecycle.isDirty("dashboard"), true);

  hiddenSnapshot.setActive("terceirizados");
  assert.equal(hiddenSnapshot.lifecycle.activate("terceirizados"), true, "retorno renderiza uma vez");
  assert.equal(hiddenSnapshot.lifecycle.activate("terceirizados"), false, "segunda ativação limpa não renderiza");
  assert.equal(hiddenSnapshot.calls.terceirizados, 1);

  const companyOnFrequency = createHarness("frequencia");
  companyOnFrequency.lifecycle.notify("empresas");
  assert.equal(Object.values(companyOnFrequency.calls).reduce((sum, value) => sum + value, 0), 0,
    "snapshot de empresas não reconstrói Frequência");
  assert.equal(companyOnFrequency.lifecycle.isDirty("empresas"), true);
  assert.equal(companyOnFrequency.lifecycle.isDirty("efetivo"), true);

  const frequencyOnCompanies = createHarness("empresas");
  frequencyOnCompanies.lifecycle.clear("empresas");
  frequencyOnCompanies.lifecycle.notify("frequencia");
  assert.equal(frequencyOnCompanies.calls.empresas, 0, "snapshot de frequência não renderiza Empresas");
  assert.equal(frequencyOnCompanies.lifecycle.isDirty("efetivo"), true);

  const navigation = createHarness("dashboard");
  const route = ["dashboard", "terceirizados", "empresas", "frequencia", "efetivo", "dashboard"];
  route.forEach((module) => {
    navigation.setActive(module);
    navigation.lifecycle.activate(module);
  });
  assert.equal(navigation.calls.dashboard, 1, "Dashboard limpo não reconstrói ao retornar");
  assert.equal(navigation.calls.terceirizados, 1);
  assert.equal(navigation.calls.empresas, 1);
  assert.equal(navigation.calls.frequencia, 1);
  assert.equal(navigation.calls.efetivo, 1);

  const tenSnapshots = createHarness("dashboard");
  tenSnapshots.lifecycle.clear("dashboard");
  const startedAt = performance.now();
  for (let index = 0; index < 10; index++) tenSnapshots.lifecycle.notify("funcionarios");
  const dispatchMs = performance.now() - startedAt;
  assert.equal(tenSnapshots.calls.dashboard, 10, "módulo visível acompanha dez snapshots");
  assert.equal(tenSnapshots.calls.terceirizados, 0, "dez snapshots não renderizam tabelas ocultas");

  const root = path.join(__dirname, "..");
  const mainSource = fs.readFileSync(path.join(root, "js", "main.js"), "utf8");
  const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const efetivoSource = fs.readFileSync(path.join(root, "js", "modules", "efetivo.js"), "utf8");
  const listenersBlock = /function wireRealtimeForUser\(\)[\s\S]*?\/\/ --- SESSÃO ---/.exec(mainSource)?.[0] || "";
  assert.doesNotMatch(listenersBlock, /refreshAll\s*\(/, "listeners globais não usam refreshAll");
  assert.match(mainSource, /efetivoDeactivate/, "navegação desativa Efetivo sem destruí-lo");
  assert.match(indexSource, /if\(freqState\.initialized\)/, "freqInit é idempotente");
  assert.match(efetivoSource, /state\.chart\.update\("none"\)/, "Chart existente atualiza dataset");
  assert.match(efetivoSource, /if \(!state\.active\)/, "Efetivo oculto não renderiza DOM/Chart");

  console.log(JSON.stringify({
    status: "ok",
    scenarios: 12,
    tenSnapshotDispatchMs: Number(dispatchMs.toFixed(3)),
    hiddenRendersForTenSnapshots: 0,
  }, null, 2));
}

run();
