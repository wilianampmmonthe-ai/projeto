"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rulesPath = path.join(__dirname, "..", "firestore.rules");
const rules = fs.readFileSync(rulesPath, "utf8");

const categoryMatch = rules.match(
  /match\s+\/efetivoConfig\/categorias\s*\{([\s\S]*?)\n\s*\}/
);

assert.ok(categoryMatch, "deve existir regra explícita para efetivoConfig/categorias");

const body = categoryMatch[1];
assert.match(body, /allow\s+read:\s*if\s+canAccessObra\(obraId\)\s*;/,
  "leitura deve reutilizar o isolamento multiobra");
assert.match(body, /allow\s+create,\s*update:\s*if\s+canWriteObraData\(obraId\)\s*;/,
  "create/update devem reutilizar a permissão de edição da obra");
assert.match(body, /allow\s+delete:\s*if\s+false\s*;/,
  "delete deve permanecer bloqueado");
assert.doesNotMatch(body, /request\.auth\s*!=\s*null|allow\s+read,\s*write:\s*if\s+true/,
  "a regra não pode liberar acesso genérico");

assert.match(rules, /function\s+canAccessObra\(obraId\)[\s\S]*?hasEnabledAccessEntry\(obraId\)/,
  "canAccessObra deve exigir o acesso da obra indicada");
assert.match(rules, /function\s+canWriteObraData\(obraId\)[\s\S]*?getObraRole\(obraId\)\s*==\s*"admin"[\s\S]*?getObraRole\(obraId\)\s*==\s*"editor"/,
  "somente admin/editor da obra podem escrever");

function expectedAuthorization({ enabled, role }, operation) {
  if (!enabled) return false;
  if (operation === "read") return true;
  if (operation === "delete") return false;
  return role === "admin" || role === "editor";
}

const matrix = [
  [{ enabled: true, role: "admin" }, "read", true],
  [{ enabled: true, role: "admin" }, "create", true],
  [{ enabled: true, role: "admin" }, "update", true],
  [{ enabled: true, role: "admin" }, "delete", false],
  [{ enabled: true, role: "editor" }, "read", true],
  [{ enabled: true, role: "editor" }, "create", true],
  [{ enabled: true, role: "editor" }, "update", true],
  [{ enabled: true, role: "editor" }, "delete", false],
  [{ enabled: true, role: "viewer" }, "read", true],
  [{ enabled: true, role: "viewer" }, "create", false],
  [{ enabled: true, role: "viewer" }, "update", false],
  [{ enabled: true, role: "viewer" }, "delete", false],
  [{ enabled: false, role: "admin" }, "read", false],
  [{ enabled: false, role: "admin" }, "create", false],
  [{ enabled: false, role: "admin" }, "update", false],
  [{ enabled: false, role: "admin" }, "delete", false],
];

matrix.forEach(([access, operation, expected]) => {
  assert.equal(expectedAuthorization(access, operation), expected,
    `${access.role}/${access.enabled ? "obra autorizada" : "sem acesso"}/${operation}`);
});

console.log("firestore-rules-categorias: estrutura e matriz esperada OK");
