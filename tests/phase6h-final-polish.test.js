"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const main = fs.readFileSync(path.join(root, "js", "main.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "remaining.css"), "utf8");
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");

for (const [modalId, titleId] of [
  ["modalCadastro", "modalCadastroTitle"],
  ["modalDetalhe", "modalDetalheTitle"],
  ["modalEmpresa", "modalEmpresaTitle"],
  ["modalEfetivoCategorias", "modalEfetivoCategoriasTitle"],
  ["modalObra", "modalObraTitle"],
  ["modalPdf", "pdfTitle"],
  ["modalFeriadoObs", "modalFeriadoObsTitle"],
  ["modalFeriado", "modalFeriadoTitle"],
  ["modalCellObs", "modalCellObsTitle"],
  ["modalFeriadoTodos", "modalFeriadoTodosTitle"],
]) {
  const start = html.indexOf(`id="${modalId}"`);
  assert.ok(start >= 0, `${modalId} deve existir`);
  const block = html.slice(start, start + 700);
  assert.match(block, /role="dialog"/);
  assert.match(block, /aria-modal="true"/);
  assert.match(block, new RegExp(`aria-labelledby="${titleId}"`));
  assert.match(html, new RegExp(`id="${titleId}"`));
}

for (const id of [
  "globalSearch", "ffNomeTerc", "ffEmpresaTerc", "ffFuncaoTerc",
  "ffNomeAtac", "ffEmpresaAtac", "ffFuncaoAtac", "feriadoObsInput",
  "feriadoDateInput", "feriadoDateObsInput", "cellObsInput",
  "feriadoTodosDateInput", "feriadoTodosNomeInput",
]) {
  assert.match(html, new RegExp(`id="${id}"[^>]+aria-label="[^"]+"`), `${id} precisa de nome acessível`);
}

for (const id of [
  "f-nome", "f-cpf", "f-admissao", "f-tipo", "f-empresa", "f-funcao", "f-tel", "f-email",
  "e-nome", "e-cnpj", "e-resp", "e-status", "e-categoria-efetivo", "e-data-inicio-obra", "e-data-fim-obra",
  "o-cnpj", "o-nome", "o-logradouro", "o-numero", "o-cep", "o-bairro", "o-municipio", "o-uf",
]) {
  assert.match(html, new RegExp(`<label for="${id}"`), `${id} precisa de label associado`);
}

assert.doesNotMatch(main, /\[LOGIN (?:PROFILE|WIRE|OBRA META|\d)/, "logs temporários de login devem ser removidos");
assert.doesNotMatch(main, /console\.debug\(/, "console.debug temporário deve ser removido");
assert.match(css, /\.admin-users-table td[^}]+font-size: 11px/s);
assert.match(css, /\.ata-page \.ata-table[^}]+font-size: 11px/s);
assert.match(gitignore, /^\.edge-phase\*\/$/m);

const temporaryProfiles = fs.readdirSync(root).filter((name) => name.startsWith(".edge-phase"));
assert.deepEqual(temporaryProfiles, [], "perfis temporários do Edge não devem permanecer no workspace");

console.log("phase6h-final-polish: acessibilidade, legibilidade, logs e limpeza técnica OK");
