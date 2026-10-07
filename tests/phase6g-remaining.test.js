"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const main = fs.readFileSync(path.join(root, "js", "main.js"), "utf8");
const auth = fs.readFileSync(path.join(root, "js", "services", "auth.service.js"), "utf8");
const dbService = fs.readFileSync(path.join(root, "js", "services", "db.service.js"), "utf8");
const lifecycle = fs.readFileSync(path.join(root, "js", "modules", "render-lifecycle.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "remaining.css"), "utf8");

function extractFunction(source, name) {
  const patterns = [`function ${name}(`, `window.${name} = async function ${name}(`, `window.${name} = async function (`];
  const start = patterns.map((pattern) => source.indexOf(pattern)).find((index) => index >= 0);
  assert.notEqual(start, undefined, `${name} deve existir`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Nao foi possivel extrair ${name}`);
}

// Login: mesmos campos, mesma autenticacao e nenhum recurso ficticio.
for (const id of ["loginScreen", "loginUser", "loginPass", "loginSubmit"]) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} deve permanecer no DOM`);
}
assert.match(html, /class="login-shell"/);
assert.match(html, /Sistema de[\s\S]*Liberação/);
assert.match(html, /label for="loginUser"/);
assert.match(html, /label for="loginPass"/);
assert.doesNotMatch(html.slice(html.indexOf("<!-- LOGIN -->"), html.indexOf("<!-- APP -->")),
  /Login com Google|Recuperar senha|Criar conta|Entrar com SSO|Lembrar-me|<img|https?:\/\//i);
assert.match(auth, /signInWithEmailAndPassword\(e, p\)/);
assert.match(auth, /firebase\.auth\(\)\.signOut\(\)/);
const loginHandler = extractFunction(main, "doLogin");
assert.match(loginHandler, /loginWithEmail\(email, pass\)/);
assert.match(loginHandler, /submitButton\.disabled = true/);
assert.match(loginHandler, /submitButton\.textContent = "Entrando\.\.\."/);
assert.match(loginHandler, /finally/);
assert.match(loginHandler, /E-mail ou senha incorretos/);

// Dados da Obra: campos, listas, validacao e payload congelados.
for (const id of [
  "modalObra", "modalObraTitle", "tab-obra-dados", "tab-obra-eng", "tab-obra-sst",
  "o-cnpj", "o-nome", "o-logradouro", "o-numero", "o-cep", "o-bairro", "o-municipio",
  "o-uf", "engTeamContainer", "sstTeamContainer", "btnSalvarObraModal",
]) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} deve permanecer no DOM`);
}
assert.match(html, /class="modal obra-modal"[^>]+role="dialog"[^>]+aria-modal="true"/);
for (const className of ["eng-nome", "eng-funcao", "eng-crea", "eng-telefone", "eng-empresa", "sst-nome", "sst-funcao", "sst-telefone", "sst-depto", "sst-mte"]) {
  assert.match(html, new RegExp(`class="${className}"`), `${className} deve permanecer`);
}
const saveObra = extractFunction(main, "saveObra");
assert.match(saveObra, /requirePermission\(window\.canEditObra/);
assert.match(saveObra, /if \(!cnpj \|\| !nome \|\| !logradouro \|\| !numero \|\| !cep \|\| !bairro \|\| !municipio \|\| !uf\)/);
assert.match(saveObra, /equipeEng: equipeEng\.length/);
assert.match(saveObra, /equipeSST: equipeSST\.length/);
assert.match(saveObra, /await salvarObra\(obra\)/);
assert.doesNotMatch(saveObra, /fetch\s*\(|addEventListener|refreshAll/);
assert.match(dbService, /async function salvarObra\(obra\)/);

// Atas: duas separacoes, filtro e lazy export intactos.
for (const id of ["page-ata-terc", "page-ata-atac", "ataDateTerc", "ataDateAtac", "ataTerc", "ataAtac", "btnAtaTercExcel", "btnAtaTercPDF", "btnAtaAtacExcel", "btnAtaAtacPDF"]) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} deve permanecer no DOM`);
}
const renderAta = extractFunction(html, "renderAta");
assert.match(renderAta, /computeStatus\(f\)===['"]conforme['"]/);
assert.match(renderAta, /class="ata-preview"/);
assert.doesNotMatch(renderAta, /fetch\s*\(|addEventListener|refreshAll/);
for (const exportName of ["exportAtaPDF", "exportAtaExcel"]) {
  const source = extractFunction(html, exportName);
  assert.match(source, /appDependencies\.runWhenReady/);
}
assert.match(main, /requirePermission\(window\.canExportDocumentos/);

// Administracao: roles, status, acesso por obra e restricao real preservados.
for (const id of ["page-admin", "adminUsersTableBody", "adminBackupSection", "backupFileInputAdmin"]) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} deve permanecer no DOM`);
}
const renderAdmin = extractFunction(main, "renderAdminUsers");
for (const role of ["admin", "editor", "viewer"]) assert.match(renderAdmin, new RegExp(`value="${role}"`));
for (const status of ["active", "blocked", "suspended"]) assert.match(renderAdmin, new RegExp(`value="${status}"`));
assert.match(renderAdmin, /normalizeAccessMap\(user\.acessos\)\[activeObraId\]/);
assert.match(renderAdmin, /Não informado/);
assert.match(renderAdmin, /Bloqueado/);
assert.match(renderAdmin, /Liberado/);
const saveAdmin = extractFunction(main, "saveAdminUser");
assert.match(saveAdmin, /requirePermission\(window\.canManageUsers/);
assert.match(saveAdmin, /acessos\[activeObraId\]/);
assert.match(saveAdmin, /await salvarUsuario\(uid/);
assert.match(main, /setElementVisible\("#nav-admin-section", canAdmin\)/);
assert.match(main, /setElementVisible\("#adminBackupSection", canAdmin\)/);

// Escopo visual e contratos globais.
assert.match(html, /css\/remaining\.css/);
assert.match(css, /@media \(max-width: 820px\)/);
assert.match(css, /@media \(max-width: 560px\)/);
assert.doesNotMatch(css, /\.dashboard|\.employee-page|\.companies-|\.freq-|\.efetivo-/,
  "folha 6G nao deve redesenhar modulos bloqueados");
assert.doesNotMatch(css, /backdrop-filter|animation\s*:|url\s*\(/,
  "6G nao deve adicionar blur, animacao ou asset remoto");
assert.doesNotMatch(
  [loginHandler, saveObra, renderAdmin, saveAdmin].join("\n"),
  /refreshAll\s*\(/
);
assert.match(lifecycle, /MODULES/);

console.log("phase6g-remaining: login, obra, atas, administracao, permissoes e escopo visual OK");
