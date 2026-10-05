"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const { createSaveQueue, setAtPath } = require("../js/modules/frequencia.js");

function makeQueue(write, extra = {}) {
  return createSaveQueue({ write, debounceMs: 60_000, retryDelays: [60_000], ...extra });
}

function cell(index, value = "Trabalhado") {
  return {
    obraId: "maxxima-salvador",
    periodoKey: "2026-05",
    segments: [index % 2 ? "terceirizados" : "novoAtacarejo", `func.${index}`, String((index % 31) + 1)],
    value,
  };
}

async function run() {
  let debouncedWrites = 0;
  const debounced = makeQueue(async () => { debouncedWrites += 1; }, { debounceMs: 10 });
  debounced.enqueue(cell(0));
  debounced.enqueue(cell(1));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(debouncedWrites, 1, "debounce automático agrupa interações rápidas");

  for (const amount of [1, 10, 30, 50]) {
    const writes = [];
    const queue = makeQueue(async (periodoKey, changes, obraId) => writes.push({ periodoKey, changes, obraId }));
    for (let index = 0; index < amount; index++) queue.enqueue(cell(index));
    await queue.flush();
    assert.equal(writes.length, 1, `${amount} alterações rápidas usam uma operação lógica`);
    assert.equal(writes[0].changes.length, amount, `${amount} field paths preservados`);
  }

  const collapsedWrites = [];
  const collapsed = makeQueue(async (periodoKey, changes) => collapsedWrites.push(changes));
  collapsed.enqueue(cell(1, "Trabalhado"));
  collapsed.enqueue(cell(1, "Folga"));
  collapsed.enqueue(cell(1, "Trabalhado"));
  await collapsed.flush();
  assert.equal(collapsedWrites[0].length, 1, "mesma célula é colapsada");
  assert.equal(collapsedWrites[0][0].value, "Trabalhado", "somente estado final é enviado");

  let attempts = 0;
  const retry = makeQueue(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("offline");
  });
  retry.enqueue(cell(2));
  await assert.rejects(retry.flush(), /offline/);
  assert.equal(retry.getPending().length, 1, "falha não descarta pendência");
  assert.equal(retry.getState().status, "error", "falha aparece no estado de sincronização");
  await retry.flush();
  assert.equal(retry.getPending().length, 0, "retry confirmado limpa pendência");

  const deletionWrites = [];
  const deletion = makeQueue(async (periodoKey, changes) => deletionWrites.push(changes));
  deletion.enqueue({ ...cell(3), remove: true, value: undefined });
  await deletion.flush();
  assert.equal(deletionWrites[0][0].remove, true, "limpeza preserva semântica de remoção de campo");

  const pending = makeQueue(async () => {});
  pending.enqueue(cell(4, "Folga"));
  const merged = pending.mergeRemote("maxxima-salvador", "2026-05", {
    terceirizados: {},
    novoAtacarejo: { "func.4": { "5": "Trabalhado" } },
    feriados: {},
  });
  assert.equal(merged.novoAtacarejo["func.4"]["5"], "Folga", "snapshot não sobrescreve alteração local pendente");
  await pending.flush();

  let persistedEntries = [];
  const persisted = makeQueue(async () => {}, { persist: (entries) => { persistedEntries = JSON.parse(JSON.stringify(entries)); } });
  persisted.enqueue(cell(5, "FaltaJustificada"));
  assert.equal(persistedEntries.length, 1, "pendência é armazenada antes de unload");
  const restoredWrites = [];
  const restored = makeQueue(async (periodoKey, changes) => restoredWrites.push(changes));
  restored.restore(persistedEntries);
  await restored.flush();
  assert.equal(restoredWrites[0][0].value, "FaltaJustificada", "reload restaura e sincroniza a fila");
  await persisted.flush();

  const sharedDocument = { feriados: {}, terceirizados: {}, novoAtacarejo: {} };
  const applyWrite = async (periodoKey, changes) => {
    changes.forEach((change) => setAtPath(sharedDocument, change.segments, change.value, change.remove));
  };
  const clientA = makeQueue(applyWrite);
  const clientB = makeQueue(applyWrite);
  clientA.enqueue({ ...cell(10), segments: ["terceirizados", "func001", "10"], value: "Trabalhado" });
  clientB.enqueue({ ...cell(11), segments: ["terceirizados", "func002", "10"], value: "Folga" });
  await Promise.all([clientA.flush(), clientB.flush()]);
  assert.equal(sharedDocument.terceirizados.func001["10"], "Trabalhado");
  assert.equal(sharedDocument.terceirizados.func002["10"], "Folga", "clientes em células distintas coexistem");

  clientA.enqueue({ ...cell(12), segments: ["terceirizados", "func001", "10"], value: "Folga" });
  clientB.enqueue({ ...cell(13), segments: ["terceirizados", "func001", "10"], value: "Demitido" });
  await clientA.flush();
  await clientB.flush();
  assert.equal(sharedDocument.terceirizados.func001["10"], "Demitido", "mesma célula segue last-write-wins");

  const statuses = ["Trabalhado", "Feriado", "Folga", "FaltaInjustificada", "FaltaJustificada", "NaoContratado", "Demitido"];
  const counts = (rows) => rows.map((row) => row.filter((status) => status === "Trabalhado").length);
  const matrix = Array.from({ length: 121 }, (_, row) => Array.from({ length: 31 }, (_, day) => statuses[(row + day) % statuses.length]));
  const fullBefore = counts(matrix);
  matrix[70][14] = "Trabalhado";
  const incrementalRow = matrix[70].filter((status) => status === "Trabalhado").length;
  const fullAfter = counts(matrix);
  assert.equal(incrementalRow, fullAfter[70], "total incremental da linha equivale ao full render");
  assert.deepEqual(fullBefore.filter((_, index) => index !== 70), fullAfter.filter((_, index) => index !== 70), "linhas não afetadas permanecem iguais");

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "js", "main.js"), "utf8");
  const serviceSource = fs.readFileSync(path.join(__dirname, "..", "js", "services", "db.service.js"), "utf8");
  const liveBody = /function freqRenderLive\(pk, changes\)\{([\s\S]*?)\n\}/.exec(indexSource)?.[1] || "";
  assert.doesNotMatch(liveBody, /freqRender\s*\(/, "marcação simples não chama full render");
  assert.match(indexSource, /wrap\.addEventListener\('click', freqCellClick\)/, "event delegation nos wrappers");
  assert.doesNotMatch(mainSource, /window\.freqSaveData\s*=/, "main não sobrescreve persistência");
  const incrementalService = /async function atualizarCamposFrequencia[\s\S]*?\n\}/.exec(serviceSource)?.[0] || "";
  assert.match(incrementalService, /FieldPath/, "Firestore usa FieldPath");
  assert.doesNotMatch(incrementalService, /\.get\s*\(/, "update incremental não executa GET");
  assert.match(incrementalService, /FieldValue\.delete/, "limpeza usa delete sentinel");

  const updateCalls = [];
  const setCalls = [];
  let missingDocument = false;
  const fakeRef = {
    update: async (...args) => {
      updateCalls.push(args);
      if (missingDocument) {
        const error = new Error("missing"); error.code = "not-found"; throw error;
      }
    },
    set: async (...args) => setCalls.push(args),
  };
  function FieldPath(...segments) { this.segments = segments; }
  const firestore = () => ({
    collection: () => ({ doc: () => ({ collection: () => ({ doc: () => fakeRef }) }) }),
  });
  firestore.FieldPath = FieldPath;
  firestore.FieldValue = { delete: () => ({ delete: true }), serverTimestamp: () => ({ timestamp: true }) };
  const serviceContext = vm.createContext({
    console,
    window: { APP_CTX: { obraAtivaId: "maxxima-salvador" } },
    localStorage: { getItem: () => "maxxima-salvador" },
    firebase: { firestore, database: () => ({ ref: () => ({ update: async () => {} }) }) },
  });
  vm.runInContext(serviceSource, serviceContext);
  await serviceContext.atualizarCamposFrequencia("2026-05", [{
    segments: ["terceirizados", "id.com.ponto", "10"], value: "Trabalhado",
  }], "maxxima-salvador");
  assert.deepEqual(updateCalls[0][0].segments, ["data", "terceirizados", "id.com.ponto", "10"], "ID com ponto usa segmentos de FieldPath");
  missingDocument = true;
  await serviceContext.atualizarCamposFrequencia("2026-06", [{
    segments: ["novoAtacarejo", "func001", "1"], value: "Folga",
  }], "maxxima-salvador");
  assert.equal(setCalls.length, 1, "documento mensal inexistente recebe set mínimo");
  assert.equal(setCalls[0][0].data.novoAtacarejo.func001["1"], "Folga");
  assert.equal(setCalls[0][1].merge, true, "criação mínima usa merge seguro");

  const benchmarkQueue = makeQueue(async () => {});
  const startedAt = performance.now();
  for (let index = 0; index < 50; index++) benchmarkQueue.enqueue(cell(index));
  const enqueueMs = performance.now() - startedAt;
  await benchmarkQueue.flush();
  assert.ok(enqueueMs < 50, `50 inclusões na fila ficam abaixo de 50 ms (medido ${enqueueMs.toFixed(2)} ms)`);

  console.log(JSON.stringify({
    status: "ok",
    scenarios: 23,
    queue50EnqueueMs: Number(enqueueMs.toFixed(3)),
    logicalWritesFor50: 1,
    delegatedListeners: 2,
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
