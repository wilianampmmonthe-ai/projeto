"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const jsPdfPath = process.env.JSPDF_UMD_PATH;
if (!jsPdfPath) throw new Error("Defina JSPDF_UMD_PATH para o arquivo jspdf.umd.min.js.");

global.window = global;
global.document = { getElementById: () => null, querySelectorAll: () => [] };
global.crypto ||= require("node:crypto").webcrypto;
global.DB = { empresas: [], funcionarios: [] };
global.APP_CTX = { obraAtivaId: "obra-pdf" };
global.canEditEmpresas = () => true;
global.getCurrentObraLabel = () => "Obra Teste BuildCo";
global.toast = () => {};

require("../js/modules/categorias-efetivo.js");
require("../js/modules/efetivo.js");

async function run() {
  global.applyEfetivoCategoriesPayload({ exists: true, categorias: [
    { id: "imp", nome: "Impermeabilização", nomeNormalizado: "IMPERMEABILIZACAO", ordem: 1, ativa: true },
    { id: "civil", nome: "Civil", nomeNormalizado: "CIVIL", ordem: 2, ativa: true },
    { id: "outros", nome: "Outros", nomeNormalizado: "OUTROS", ordem: 3, ativa: true },
  ] });
  global.DB.empresas = [
    { id: "e1", nome: "Empresa Imper", categoriaEfetivoId: "imp" },
    { id: "e2", nome: "Empresa Civil", categoriaEfetivoId: "civil" },
    { id: "e3", nome: "Empresa Legada", categoriaEfetivo: "CIVIL" },
    { id: "e4", nome: "Empresa Sem Categoria", categoriaEfetivo: "DESCONHECIDA" },
  ];
  global.DB.funcionarios = global.DB.empresas.map((empresa, index) => ({
    id: `f${index + 1}`,
    nome: `Pessoa ${index + 1}`,
    empresaId: empresa.id,
    tipo: "Terceirizado",
  }));
  const frequency = { terceirizados: {}, novoAtacarejo: {}, feriados: {} };
  global.DB.funcionarios.forEach((employee, index) => {
    frequency.terceirizados[employee.id] = {};
    for (let day = 1; day <= 31; day += 1) {
      frequency.terceirizados[employee.id][day] = day % (index + 2) === 0 ? "" : "Trabalhado";
    }
  });
  const consolidated = global.efetivoUtils.consolidateFrequency("2026-10", frequency);
  const dataset = global.efetivoUtils.normalizeDataset({
    obraId: "obra-pdf",
    project: "Obra Teste BuildCo",
    source: "Frequência",
    updatedAt: "01/10/2026 12:00",
    periodoKey: "2026-10",
    categories: consolidated.categories,
    dayHasData: consolidated.dayHasData,
    uniquePresentTotals: consolidated.uniquePresentTotals,
    derivedFromFrequency: true,
  }, "2026-10");
  const computed = global.efetivoUtils.computeDataset(dataset);
  assert.deepEqual(computed.categories.map((item) => item.name), ["IMPERMEABILIZAÇÃO", "CIVIL", "OUTROS"]);

  const { jsPDF } = require(path.resolve(jsPdfPath));
  const logoPath = path.resolve(__dirname, "../assets/img/buildco-logo-light.png");
  const logoData = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
  const result = await global.efetivoUtils.createEfetivoPdf(computed, {
    jsPDF,
    save: false,
    generatedAt: new Date("2026-10-01T15:00:00Z"),
    logoData,
    logoRatio: 4,
  });
  assert.equal(result.doc.getNumberOfPages(), 2, "dashboard + tabela em uma página");
  const outputPath = path.resolve(process.env.PHASE42_PDF_OUTPUT || "phase42-dynamic-31.pdf");
  fs.writeFileSync(outputPath, Buffer.from(result.doc.output("arraybuffer")));
  console.log(outputPath);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
