"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const main = fs.readFileSync(path.join(root, "js", "main.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "employees.css"), "utf8");

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

const statusFunctions = [
  "computeStatus",
  "docsProgress",
  "isResolvedDocumentStatus",
  "getRequiredDocs",
  "getApplicableDocs",
].map((name) => extractFunction(html, name)).join("\n");

const context = {
  DOCS_TERCEIRIZADO: ["ASO", "RG"],
  TRAINS_OBRIG_TERC: ["NR18"],
  DOCS_ATACAREJO: ["ASO", "Ficha"],
  TRAINS_ATACAREJO: ["NR06"],
  TRAINS_COND_STATUS: ["NR10", "NR11"],
  makeKey: (name) => name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "_"),
  normalizeEmpresaStatusValue: (status) => status || "Pendente",
  isExpired: (deadline) => new Date(deadline).getTime() < Date.now(),
};

vm.runInNewContext(`${statusFunctions}; this.api = { computeStatus, docsProgress, getApplicableDocs };`, context);
const { computeStatus, docsProgress, getApplicableDocs } = context.api;

const conformThirdParty = {
  tipo: "Terceirizado",
  docs: { ASO: { status: "Conforme" }, RG: { status: "Não se aplica" }, NR18: { status: "Conforme" } },
};
assert.equal(computeStatus(conformThirdParty), "conforme");
assert.deepEqual({ ...docsProgress(conformThirdParty) }, { done: 3, total: 3, pct: 100 });

const missingOwnDocument = {
  tipo: "Novo Atacarejo",
  docs: { ASO: { status: "Conforme" }, Ficha: { status: "Conforme" } },
};
assert.equal(computeStatus(missingOwnDocument), "pendente", "documento obrigatório ausente mantém pendência");

const conditionalTrainings = {
  tipo: "Terceirizado",
  docs: {
    ASO: { status: "Conforme" }, RG: { status: "Conforme" }, NR18: { status: "Conforme" },
    NR10: { status: "Não se aplica" }, NR11: { status: "Pendente", deadline: "2000-01-01" },
  },
};
assert.deepEqual(Array.from(getApplicableDocs(conditionalTrainings)), ["ASO", "RG", "NR18", "NR10", "NR11"]);
assert.equal(computeStatus(conditionalTrainings), "irregular", "NR-11 pendente e vencida é irregular");
assert.deepEqual({ ...docsProgress(conditionalTrainings) }, { done: 4, total: 5, pct: 80 });

conditionalTrainings.docs.NR11 = { status: "Pendente", deadline: "2999-01-01" };
assert.equal(computeStatus(conditionalTrainings), "pendente");
conditionalTrainings.docs.NR11 = { status: "Não Conforme" };
assert.equal(computeStatus(conditionalTrainings), "irregular");
conditionalTrainings.docs.NR11 = { status: "Não se aplica" };
assert.equal(computeStatus(conditionalTrainings), "conforme");

const formElements = new Map([
  ["doc_ASO", { value: "Pendente" }],
  ["doc_RG", { value: "Conforme" }],
  ["doc_NR18", { value: "Não se aplica" }],
  ["doc_NR10", { value: "Conforme" }],
  ["chk_NR10", { checked: true }],
  ["chk_NR11", { checked: false }],
]);
const collectContext = {
  DB: {
    currentEditId: "f1",
    funcionarios: [{
      id: "f1",
      docs: {
        ASO: { status: "Conforme", fileName: "aso-antigo.pdf", dataURL: "data:aso" },
        NR11: { status: "Conforme", fileName: "nr11-antigo.pdf" },
        legado_externo: { status: "Conforme", origem: "histórica" },
      },
    }],
    tempDocs: { NR10: { name: "nr10-novo.pdf", dataURL: "data:nr10" } },
  },
  DOCS_TERCEIRIZADO: ["ASO", "RG"],
  TRAINS_OBRIG_TERC: ["NR18"],
  DOCS_ATACAREJO: ["Ficha"],
  TRAINS_ATACAREJO: ["NR06"],
  TRAINS_COND_TERC: ["NR10", "NR11"],
  TRAINS_COND_ATACAREJO: ["NR10", "NR11"],
  makeKey: context.makeKey,
  addBusinessDays: () => new Date("2026-10-09T12:00:00.000Z"),
  document: { getElementById: (id) => formElements.get(id) || null },
  Date,
};
vm.runInNewContext(`${extractFunction(html, "collectDocs")}; this.result = collectDocs('Terceirizado');`, collectContext);
assert.equal(collectContext.result.legado_externo.origem, "histórica", "documento legado não gerenciado deve permanecer");
assert.equal(collectContext.result.ASO.fileName, "aso-antigo.pdf", "anexo anterior deve permanecer ao editar status");
assert.equal(collectContext.result.ASO.deadline, "2026-10-09T12:00:00.000Z", "pendência recebe prazo atual");
assert.equal(collectContext.result.NR10.fileName, "nr10-novo.pdf", "anexo novo de treinamento condicional deve ser salvo");
assert.equal(Object.hasOwn(collectContext.result, "NR11"), false, "condicional desmarcada deixa de ser gerenciada");

for (const id of [
  "page-terceirizados", "page-atacarejo", "tercTable", "atacTable",
  "btnNovoTerceirizado", "btnNovoAtacarejo", "modalCadastro", "modalCadastroTitle",
  "tab-dados", "tab-docs", "tab-train", "docsFields", "trainFields",
  "f-nome", "f-cpf", "f-tipo", "f-empresa", "f-funcao", "f-admissao", "f-tel", "f-email",
]) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} deve permanecer no DOM`);
}

assert.match(html, /<th>#<\/th><th>Nome<\/th><th>CPF<\/th><th>Empresa<\/th><th>Função<\/th><th>Status<\/th><th>Docs<\/th><th>Prazo<\/th><th>Ações<\/th>/);
assert.match(html, /<th>#<\/th><th>Nome<\/th><th>CPF<\/th><th>Empresa<\/th><th>Função<\/th><th>Status<\/th><th>Docs<\/th><th>Ações<\/th>/);
assert.match(html, /openCadastroModal\('Terceirizado'\)/);
assert.match(html, /openCadastroModal\('Novo Atacarejo'\)/);
assert.match(html, /saveFuncionario\(\)/);
assert.match(html, /handleSearch\(this\.value\)/, "pesquisa global existente deve permanecer");
assert.match(html, /accept="\.pdf,image\/\*"/, "anexos PDF e imagem devem permanecer aceitos");

const filterSource = extractFunction(html, "filterTable");
assert.match(filterSource, /if\(table === 'terceirizados'\) renderTerceirizados\(\)/);
assert.match(filterSource, /if\(table === 'atacarejo'\) renderAtacarejo\(\)/);
assert.doesNotMatch(filterSource, /addEventListener|fetch\s*\(|refreshAll/);

for (const name of ["computeStatus", "docsProgress", "getApplicableDocs", "collectDocs"]) {
  assert.match(html, new RegExp(`function ${name}\\(`), `${name} deve ser preservada`);
}
assert.match(html, /const docs = \{ \.\.\.previousDocs \}/, "collectDocs deve preservar documentos compatíveis");
assert.match(main, /empresaId/);
assert.match(main, /window\.canEditFuncionarios/);
assert.match(main, /requirePermission\(window\.canEditFuncionarios/);
assert.match(main, /window\.isAdmin\(\) \|\| window\.isEditor\(\)/, "Admin e Editor mantêm edição; Viewer não");
assert.match(main, /await window\.openConfirmModal/, "exclusão deve manter confirmação");
assert.match(main, /lifecycle\.register\("terceirizados"/);
assert.match(main, /lifecycle\.register\("atacarejo"/);

assert.match(css, /#modalCadastro \.doc-item/);
assert.match(css, /@media \(max-width: 560px\)/);
assert.doesNotMatch(css, /backdrop-filter|linear-gradient|radial-gradient/, "módulo não deve adicionar glassmorphism ou gradientes");

console.log("phase6c-employees: listagens, documentos, condicionais, permissões e responsividade OK");
