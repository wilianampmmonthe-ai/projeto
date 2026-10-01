"use strict";

const assert = require("node:assert/strict");

global.window = global;
global.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
};
global.crypto ||= require("node:crypto").webcrypto;
global.DB = { empresas: [], funcionarios: [] };
global.APP_CTX = { obraAtivaId: "obra-a" };
global.canEditEmpresas = () => true;
global.toast = () => {};

require("../js/modules/categorias-efetivo.js");
require("../js/modules/efetivo.js");

const categories = global.efetivoCategoryUtils;
const efetivo = global.efetivoUtils;

async function run() {
  let writes = 0;
  global.saveEfetivoCategorias = async () => { writes += 1; };

  categories.applyCategoriesPayload({ exists: false, categorias: [] });
  assert.equal(categories.getCategories().length, 6, "fallback padrão");
  assert.equal(writes, 0, "fallback não grava silenciosamente");

  let list = categories.createCategoryRecord([], "Impermeabilização", { id: "cat-imp", now: "2026-01-01" });
  assert.equal(list[0].nomeNormalizado, "IMPERMEABILIZACAO");
  assert.throws(() => categories.createCategoryRecord(list, "  impermeabilizacao  "), /existe/i);
  const longName = "Tratamento e impermeabilização especializada de fachadas";
  const withLongName = categories.createCategoryRecord(list, longName, { id: "cat-longa", now: "2026-01-01" });
  assert.equal(withLongName.find((item) => item.id === "cat-longa").nome, longName, "nome longo e acentuado preservado");

  list = categories.renameCategoryRecord(list, "cat-imp", "Impermeabilização especial", "2026-01-02");
  assert.equal(list[0].id, "cat-imp", "renomeação preserva ID");
  assert.deepEqual(list[0].nomesAnterioresNormalizados, ["IMPERMEABILIZACAO"]);

  categories.applyCategoriesPayload({ exists: true, categorias: list });
  assert.equal(categories.resolveCategory({ categoriaEfetivo: "Impermeabilização" }).id, "cat-imp", "nome anterior continua resolvível");

  list = categories.toggleCategoryRecord(list, "cat-imp", "2026-01-03");
  assert.equal(list[0].ativa, false);
  categories.applyCategoriesPayload({ exists: true, categorias: list });
  assert.equal(categories.getCategories().length, 0, "inativa não aparece em novos vínculos");
  assert.equal(categories.resolveCategory({ categoriaEfetivoId: "cat-imp" }).id, "cat-imp", "inativa permanece resolvível");

  list = categories.toggleCategoryRecord(list, "cat-imp", "2026-01-04");
  assert.equal(list[0].ativa, true, "reativação");
  list = categories.createCategoryRecord(list, "Civil", { id: "cat-civil", now: "2026-01-04" });
  list = categories.moveCategoryRecord(list, "cat-civil", -1, "2026-01-05");
  assert.deepEqual(list.map((item) => item.id), ["cat-civil", "cat-imp"], "reordenação");

  categories.applyCategoriesPayload({ exists: true, categorias: [{ id: "a", nome: "Obra A", nomeNormalizado: "OBRA_A", ordem: 1, ativa: true }] });
  assert.equal(categories.getCategories()[0].id, "a");
  categories.applyCategoriesPayload({ exists: true, categorias: [{ id: "b", nome: "Obra B", nomeNormalizado: "OBRA_B", ordem: 1, ativa: true }] });
  assert.deepEqual(categories.getCategories().map((item) => item.id), ["b"], "troca de obra não mistura listas");
  assert.equal(categories.deleteCategory(), false, "exclusão destrutiva indisponível");

  global.canEditEmpresas = () => false;
  await global.initializeDefaultEfetivoCategories();
  assert.equal(writes, 0, "viewer não grava");
  global.canEditEmpresas = () => true;

  const configured = [
    { id: "unused", nome: "Sem empresas", nomeNormalizado: "SEM_EMPRESAS", ordem: 1, ativa: true },
    { id: "imp", nome: "Impermeabilização", nomeNormalizado: "IMPERMEABILIZACAO", ordem: 2, ativa: true },
    { id: "civil", nome: "Civil", nomeNormalizado: "CIVIL", ordem: 3, ativa: true },
    { id: "pais", nome: "Paisagismo", nomeNormalizado: "PAISAGISMO", ordem: 4, ativa: false },
    { id: "outros", nome: "Outros", nomeNormalizado: "OUTROS", ordem: 5, ativa: true },
  ];
  const companyCategorySelect = { innerHTML: "", value: "", disabled: false };
  global.document.getElementById = (id) => id === "e-categoria-efetivo" ? companyCategorySelect : null;
  categories.applyCategoriesPayload({ exists: true, categorias: configured });
  assert.match(companyCategorySelect.innerHTML, /Impermeabilização/, "empresa nova recebe categoria dinâmica");
  assert.doesNotMatch(companyCategorySelect.innerHTML, /Paisagismo/, "empresa nova não recebe categoria inativa");
  global.document.getElementById = () => null;
  global.DB.empresas = [
    { id: "e1", nome: "Empresa Um", categoriaEfetivoId: "imp", categoriaEfetivo: "IMPERMEABILIZACAO" },
    { id: "e2", nome: "Empresa Dois", categoriaEfetivo: "civil" },
    { id: "e3", nome: "Empresa Três", categoriaEfetivoId: "pais" },
    { id: "e4", nome: "Empresa Quatro", categoriaEfetivoId: "inexistente", categoriaEfetivo: "tambem inexistente" },
  ];
  global.DB.funcionarios = global.DB.empresas.map((company, index) => ({
    id: `f${index + 1}`,
    nome: `Pessoa ${index + 1}`,
    empresaId: company.id,
    tipo: "Terceirizado",
  }));
  const frequency = { terceirizados: {}, novoAtacarejo: {}, feriados: {} };
  global.DB.funcionarios.forEach((employee) => { frequency.terceirizados[employee.id] = { 1: "Trabalhado" }; });

  const consolidated = efetivo.consolidateFrequency("2026-10", frequency);
  assert.deepEqual(consolidated.categories.map((item) => item.id), ["imp", "civil", "pais", "outros"]);
  assert.ok(!consolidated.categories.some((item) => item.id === "unused"), "categoria vazia não é exibida");
  assert.equal(consolidated.categories.find((item) => item.id === "pais").companies.length, 1, "categoria inativa preserva vínculo");

  const days = efetivo.createMonthDays(2026, 9);
  const dataset = efetivo.normalizeDataset({
    project: "Teste",
    periodoKey: "2026-10",
    days,
    categories: consolidated.categories,
    dayHasData: consolidated.dayHasData,
    uniquePresentTotals: consolidated.uniquePresentTotals,
    derivedFromFrequency: true,
  }, "2026-10");
  const computed = efetivo.computeDataset(dataset);
  assert.equal(computed.dailyTotals[0], 4, "total geral");
  assert.ok(computed.categories.every((item) => item.totals[0] === 1), "subtotais por categoria");
  assert.equal(computed.activeCompanies, 4);

  const historical = efetivo.normalizeDataset({
    periodoKey: "2026-10",
    categories: [{ id: "imp", name: "NOME ANTIGO DO SNAPSHOT", companies: [{ name: "Empresa Um", values: [2] }] }],
  }, "2026-10");
  assert.equal(historical.categories[0].name, "NOME ANTIGO DO SNAPSHOT", "snapshot preserva nome histórico");

  console.log("phase42-categorias: OK");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
