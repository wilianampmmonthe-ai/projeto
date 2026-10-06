"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.resolve(__dirname, "..", "index.html"), "utf8");

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
  throw new Error(`Não foi possível extrair ${name}`);
}

function makeElement() {
  const classes = new Set();
  return {
    textContent: "",
    style: {},
    className: "",
    attributes: {},
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); },
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
  };
}

function runScenario(statuses) {
  const ids = [
    "stat-liberados", "stat-pendentes", "stat-irregulares", "stat-total",
    "capacityBar", "capacityText", "capacityPercent", "capacityCount",
    "capacityTotal", "capacityCurrent", "capacityAvailable", "capacityAvailableInline",
    "dashboardCapacityContext", "dashboardObraName", "dashboardObraLocation",
    "dashboardAttention", "attentionStateLabel", "attentionMessageTitle", "attentionMessageText",
    "attentionPendingCount", "attentionIrregularCount",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement()]));
  elements.capacityBar.parentElement = makeElement();

  const context = {
    DB: { funcionarios: statuses.map((status, index) => ({ id: index + 1, status })) },
    computeStatus: (funcionario) => funcionario.status,
    getActiveObraMeta: () => ({ nome: "Maxxima Salvador", cidade: "Salvador", uf: "BA" }),
    updateFuncionarioBadges: () => {},
    document: { getElementById: (id) => elements[id] || null },
    Number,
    Math,
  };

  vm.runInNewContext(`${extractFunction(html, "refreshDashboard")}; refreshDashboard();`, context);
  return elements;
}

const regular = runScenario(["conforme", "conforme"]);
assert.equal(regular["stat-total"].textContent, 2);
assert.equal(regular["stat-liberados"].textContent, 2);
assert.equal(regular["capacityAvailable"].textContent, 348);
assert.equal(regular.dashboardAttention.classList.contains("is-regular"), true);
assert.equal(regular.attentionStateLabel.textContent, "Situação regular");

const pending = runScenario(["conforme", "pendente", "pendente"]);
assert.equal(pending["stat-pendentes"].textContent, 2);
assert.equal(pending.dashboardAttention.classList.contains("has-attention"), true);
assert.equal(pending.attentionPendingCount.textContent, 2);
assert.equal(pending.attentionStateLabel.textContent, "Atenção necessária");

const irregular = runScenario(["conforme", "pendente", "irregular", "irregular"]);
assert.equal(irregular["stat-irregulares"].textContent, 2);
assert.equal(irregular.dashboardAttention.classList.contains("has-irregular"), true);
assert.equal(irregular.attentionIrregularCount.textContent, 2);
assert.equal(irregular.attentionStateLabel.textContent, "Ação imediata");

const overCapacity = runScenario(Array.from({ length: 360 }, () => "conforme"));
assert.equal(overCapacity.capacityPercent.textContent, "100%");
assert.equal(overCapacity.capacityAvailable.textContent, 0);
assert.equal(overCapacity.capacityBar.parentElement.attributes["aria-valuenow"], "100");

for (const required of [
  "dashboardObraName", "stat-total", "stat-liberados", "stat-pendentes", "stat-irregulares",
  "capacityTotal", "capacityCurrent", "capacityAvailable", "dashboardAttention", "dashTable",
  "btnNovoFuncionarioDashboard", "globalSearch",
]) {
  assert.match(html, new RegExp(`id="${required}"`), `${required} deve permanecer no DOM`);
}

const refreshSource = extractFunction(html, "refreshDashboard");
assert.doesNotMatch(refreshSource, /fetch\s*\(|firestore|\.get\s*\(|addEventListener|refreshAll/);

console.log("phase6b-dashboard: KPIs, capacidade e estados operacionais OK");
