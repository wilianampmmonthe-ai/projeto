"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const main = fs.readFileSync(path.join(root, "js", "main.js"), "utf8");
const dbService = fs.readFileSync(path.join(root, "js", "services", "db.service.js"), "utf8");
const categoriesModule = fs.readFileSync(path.join(root, "js", "modules", "categorias-efetivo.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "companies.css"), "utf8");

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

for (const id of [
  "page-empresas", "empresasList", "btnGerenciarCategoriasEfetivo", "btnNovaEmpresa",
  "modalEmpresa", "modalEmpresaTitle", "e-nome", "e-cnpj", "e-resp", "e-status",
  "e-categoria-efetivo", "e-data-inicio-obra", "e-data-fim-obra", "e-pgr", "e-pcmso", "e-art",
  "modalEfetivoCategorias", "efetivo-category-list", "efetivo-category-create",
  "efetivo-category-new-name", "efetivo-category-readonly", "modalInativarEmpresa",
  "e-inativar-data-fim-obra",
]) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} deve permanecer no DOM`);
}

for (const heading of ["Empresa", "Situação", "Categoria", "Período na obra", "Colaboradores", "Documentos", "Ações"]) {
  assert.match(extractFunction(html, "renderEmpresas"), new RegExp(`<th>${heading}<\\/th>`));
}
assert.match(html, /company-form-section__head"><strong>Identificação/);
assert.match(html, /company-form-section__head"><strong>Atuação na obra/);
assert.match(html, /company-form-section__head"><strong>Documentos da empresa/);

const linkContext = {
  DB: {
    empresas: [
      { id: "e1", nome: "Empresa Única" },
      { id: "e2", nome: "Nome Duplicado" },
      { id: "e3", nome: "Nome Duplicado" },
    ],
  },
};
vm.runInNewContext(`
  ${extractFunction(html, "normalizeEmpresaName")}
  ${extractFunction(html, "findEmpresaById")}
  ${extractFunction(html, "resolveEmpresaByUniqueName")}
  ${extractFunction(html, "isFuncionarioLinkedToEmpresa")}
  this.api = { resolveEmpresaByUniqueName, isFuncionarioLinkedToEmpresa };
`, linkContext);
assert.equal(linkContext.api.resolveEmpresaByUniqueName("empresa unica").id, "e1", "fallback único por nome");
assert.equal(linkContext.api.resolveEmpresaByUniqueName("Nome Duplicado"), null, "nome ambíguo não cria vínculo");
assert.equal(linkContext.api.isFuncionarioLinkedToEmpresa({ empresaId: "e3", empresa: "Empresa Única" }, linkContext.DB.empresas[2]), true, "empresaId prevalece");
assert.equal(linkContext.api.isFuncionarioLinkedToEmpresa({ empresa: "Empresa Única" }, linkContext.DB.empresas[0]), true, "legado único permanece resolvível");

const listNode = { innerHTML: "" };
const renderContext = {
  DB: {
    empresas: [
      { id: "e1", nome: "Construtora Alfa", cnpj: "11.111.111/0001-11", resp: "Ana", status: "ativa", dataInicioObra: "2026-01-10", categoriaEfetivoId: "civil", docs: { pgr: { status: "Conforme" }, pcmso: { status: "Pendente" }, art: { status: "Não se aplica" } } },
      { id: "e2", nome: "Empresa Encerrada", status: "inativa", dataInicioObra: "2025-01-01", dataFimObra: "2026-03-31", categoriaEfetivoId: "antiga", docs: {} },
      { id: "e3", nome: "Cadastro Legado", status: "ativa", docs: {} },
    ],
    funcionarios: [
      { empresaId: "e1", empresa: "Nome Antigo" },
      { empresa: "Construtora Alfa" },
      { empresaId: "e2", empresa: "Empresa Encerrada" },
    ],
  },
  document: { getElementById: (id) => id === "empresasList" ? listNode : null },
  SVG_EMPTY_STATE: "",
  window: {
    resolveEfetivoCategoryForEmpresa: (company) => company.categoriaEfetivoId === "civil"
      ? { id: "civil", nome: "Civil", ativa: true }
      : company.categoriaEfetivoId === "antiga" ? { id: "antiga", nome: "Categoria antiga", ativa: false } : null,
  },
  normalizeEmpresaLifecycleStatus: (company) => company.status === "inativa" ? "inativa" : "ativa",
  formatEmpresaLifecycleDate: (value) => value ? value.split("-").reverse().join("/") : "",
  isFuncionarioLinkedToEmpresa: (employee, company) => employee.empresaId
    ? employee.empresaId === company.id
    : employee.empresa === company.nome,
  escapeEmpresaCategoryLabel: (value) => String(value || ""),
  formatEmpresaCategoriaEfetivo: () => "Outros",
  renderEditActionButton: () => '<button class="edit-btn">Editar</button>',
  renderDeleteActionButton: () => '<button class="delete-btn">Excluir</button>',
  normalizeEmpresaStatusValue: (value) => value || "Pendente",
  getDocumentStatusBadgeClass: (value) => value === "Conforme" ? "conforme" : value === "Não Conforme" ? "irregular" : value === "Não se aplica" ? "nao-se-aplica" : "pendente",
  JSON,
  Array,
};
renderContext.window.window = renderContext.window;
vm.runInNewContext(`${extractFunction(html, "renderEmpresas")}; renderEmpresas();`, renderContext);
assert.match(listNode.innerHTML, /class="companies-table"/);
assert.match(listNode.innerHTML, /<strong>2<\/strong> colaboradores/, "contagem usa estado já carregado");
assert.match(listNode.innerHTML, /class="is-inactive"/);
assert.match(listNode.innerHTML, /10\/01\/2026 — Atual/);
assert.match(listNode.innerHTML, /Categoria inativa/);
assert.match(listNode.innerHTML, /Sem categoria/);

const saveEmpresaSource = main.slice(main.indexOf("window.saveEmpresa ="), main.indexOf("window.openInativarEmpresaModal"));
assert.match(saveEmpresaSource, /requestedStatus === "inativa" && !requestedDataFimObra/);
assert.match(saveEmpresaSource, /requestedDataFimObra < dataInicioObra/);
assert.match(saveEmpresaSource, /categoriaEfetivoId: categoriaSelecionada\.id/);
assert.match(saveEmpresaSource, /categoriaEfetivo: categoriaSelecionada\.nomeNormalizado/);
assert.match(saveEmpresaSource, /Categorias inativas não podem receber novos vínculos/);
assert.match(saveEmpresaSource, /nome não pode ser alterado enquanto houver funcionários vinculados/);

const removeEmpresaSource = main.slice(main.indexOf("window.removeEmpresa ="), main.indexOf("// --- OBRA: SALVAR"));
assert.match(removeEmpresaSource, /hasLinkedEmployees/);
assert.match(removeEmpresaSource, /Inative-a para preservar o histórico/);
assert.match(removeEmpresaSource, /await window\.openConfirmModal/);
assert.match(removeEmpresaSource, /requirePermission\(window\.canEditEmpresas/);

const categorySave = extractFunction(dbService, "salvarEfetivoCategorias");
assert.match(categorySave, /doc\("categorias"\)/, "categorias permanecem no documento único");
assert.match(categorySave, /categorias: list/);
assert.match(categorySave, /ref\.set\(/);
assert.doesNotMatch(categorySave, /\.delete\s*\(/, "documento único nunca é excluído");

assert.match(categoriesModule, /const next = removeCategoryRecord\(latestCategories, latestCategory\.id\)/);
assert.match(categoriesModule, /isCategoryLinkedToCompanies\(latestCategory/);
assert.match(categoriesModule, /nomesAnterioresNormalizados/);
assert.match(categoriesModule, /list\.addEventListener\("click"/);
assert.doesNotMatch(categoriesModule, /querySelectorAll\("\[data-category-action\]"\)\.forEach/, "ações usam delegação única");
assert.match(categoriesModule, /readOnlyNote\.hidden = editable/);

assert.match(main, /window\.canEditEmpresas = function canEditEmpresas/);
assert.match(main, /window\.isAdmin\(\) \|\| window\.isEditor\(\)/);
assert.match(main, /lifecycle\.register\("empresas"/);
assert.doesNotMatch(extractFunction(html, "renderEmpresas"), /fetch\s*\(|addEventListener|refreshAll|firestore/i);

assert.match(css, /\.companies-table/);
assert.match(css, /#modalEmpresa \.company-modal/);
assert.match(css, /#modalEfetivoCategorias \.category-modal/);
assert.match(css, /@media \(max-width: 600px\)/);
assert.doesNotMatch(css, /backdrop-filter|linear-gradient|radial-gradient/);

console.log("phase6d-companies: empresas, vínculos, ciclo de vida, categorias e documento único OK");
