"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "frequency.css"), "utf8");
const persistence = fs.readFileSync(path.join(root, "js", "modules", "frequencia.js"), "utf8");
const dbService = fs.readFileSync(path.join(root, "js", "services", "db.service.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} deve existir`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Nao foi possivel extrair ${name}`);
}

for (const id of [
  "page-frequencia", "freqMesSelect", "freqSyncStatus", "freqWrapTerc", "freqWrapAtac",
  "freqCountTotal", "freqCountTerc", "freqCountAtac", "ffNomeTerc", "ffEmpresaTerc",
  "ffFuncaoTerc", "ffNomeAtac", "ffEmpresaAtac", "ffFuncaoAtac", "freqContextMenu",
  "btnFreqFeriadosMes", "btnFreqFeriadoTodos", "btnFreqFolgaTodos", "btnFreqExportExcel",
  "btnFreqExportPDF", "freqFeriadosPanel", "freqFeriadosList",
]) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} deve permanecer no DOM`);
}

assert.match(html, /<label for="freqMesSelect">Competência<\/label>/);
assert.match(html, /id="freqSyncStatus"[^>]+role="status"[^>]+aria-live="polite"/);

const buildTable = extractFunction(html, "freqBuildTableHTML");
for (const contract of [
  "data-freq-tipo", "data-freq-funcionario", "data-tipo", "data-fid", "data-dia",
  "data-status", "data-freq-row-total", "data-freq-day-total", "data-freq-grand-total",
]) {
  assert.match(buildTable, new RegExp(contract), `${contract} deve permanecer no renderer`);
}

const bindEvents = extractFunction(html, "freqBindCellEvents");
assert.match(bindEvents, /\['freqWrapTerc','freqWrapAtac'\]/, "os dois wrappers delegados permanecem");
assert.match(bindEvents, /wrap\.addEventListener\('click', freqCellClick\)/, "clique permanece delegado");
assert.match(bindEvents, /wrap\.dataset\.freqDelegated === 'true'/, "binding permanece idempotente");

const normalMarking = extractFunction(html, "freqCtxApply");
assert.doesNotMatch(normalMarking, /freqRender\s*\(/, "marcacao normal nao executa full render");
assert.match(normalMarking, /freqRenderLive\(pk, changes\)/, "marcacao usa atualizacao incremental");

const incremental = extractFunction(html, "freqApplyIncrementalChanges");
assert.match(incremental, /freqUpdateCellElement\(pk, cell\)/);
assert.match(incremental, /freqUpdateIncrementalTotals\(affectedRows, affectedDays\)/);
assert.doesNotMatch(incremental, /innerHTML|freqRender\s*\(/, "incremental nao reconstrói tabela");

assert.match(extractFunction(html, "freqChangePeriod"), /freqFlushPending\(\{ periodoKey: previousPeriod \}\)/,
  "troca de competencia preserva flush");
assert.match(extractFunction(html, "freqCtxApply"), /openCellObsModal/,
  "observacao individual permanece no fluxo");
assert.match(extractFunction(html, "aplicarFolgaFimDeSemana"), /freqRenderLive/,
  "acao em massa permanece incremental");
assert.match(extractFunction(html, "freqRenderFeriadosList"), /freq-feriado-chip/,
  "feriados continuam visiveis e removiveis");
assert.match(extractFunction(html, "freqApplyRemoteSnapshot"), /if\(!pageActive \|\| pk !== freqState\.periodoKey\)/,
  "snapshot oculto somente marca dirty");

for (const status of [
  "Trabalhado", "Feriado", "Folga", "FaltaInjustificada", "FaltaJustificada",
  "NaoContratado", "Demitido",
]) {
  assert.match(html, new RegExp(`${status}:\\s*\\{`), `${status} deve permanecer no mapa`);
  assert.match(css, new RegExp(`\\.freq-cell\\.st-${status}\\s*\\{`), `${status} deve ter tratamento visual`);
}
const statusMap = html.slice(html.indexOf("const FREQ_STATUS"), html.indexOf("const FREQ_KEY_MAP"));
assert.doesNotMatch(statusMap, /Férias|Atestado/, "nenhum status novo foi introduzido na frequência");

assert.match(css, /\.freq-wrap\s*\{[\s\S]*?overflow:\s*auto/);
assert.match(css, /\.freq-table thead\s*\{[\s\S]*?position:\s*sticky/);
assert.match(css, /\.freq-table th\.col-fixed,[\s\S]*?position:\s*sticky/);
assert.match(css, /@media \(max-width: 768px\)/);
assert.match(css, /\.freq-table \.col-nome\s*\{[\s\S]*?position:\s*sticky/);
assert.doesNotMatch(css, /backdrop-filter|linear-gradient|radial-gradient|animation\s*:/);

for (const match of css.matchAll(/\.freq-cell(?:[^,{]*)?\s*\{([^}]*)\}/g)) {
  assert.doesNotMatch(match[1], /transition\s*:|transform\s*:|box-shadow\s*:|filter\s*:/,
    "celulas nao devem receber efeitos caros");
}

assert.match(persistence, /DEFAULT_DEBOUNCE_MS = 250/);
assert.match(persistence, /freqPendingChanges:v1/);
assert.match(persistence, /retryDelays \|\| \[1000, 2000, 4000, 8000, 10000\]/);
assert.match(persistence, /\[tipo, funcionarioId, String\(dia\)\]/);
for (const state of ["✓ Salvo", "● Salvando...", "⚠ Erro ao salvar"]) {
  assert.match(persistence, new RegExp(state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${state} deve permanecer`);
}
assert.match(dbService, /new firebase\.firestore\.FieldPath\("data", \.\.\.change\.segments\.map/);
assert.match(dbService, /firebase\.firestore\.FieldValue\.delete\(\)/);

console.log("phase6e-frequency: casca visual, DOM incremental, estados, responsividade e persistencia granular OK");
