"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "foundation.css"), "utf8");

const expectedTokens = {
  "--canvas": "#101720",
  "--navigation": "#0c1218",
  "--surface": "#151e2a",
  "--surface-3": "#1b2634",
  "--border-ui": "#2a3544",
  "--text-primary": "#e8edf4",
  "--action": "#3978e8",
  "--success": "#58c59a",
  "--warning": "#e5b45e",
  "--danger": "#e96268",
};

for (const [token, value] of Object.entries(expectedTokens)) {
  assert.match(css, new RegExp(`${token}:\\s*${value}`, "i"), `${token} deve usar ${value}`);
}

assert.match(css, /--sidebar-width:\s*224px/);
assert.match(css, /--header-height:\s*64px/);
assert.match(css, /--control-height:\s*36px/);
assert.match(html, /<link rel="stylesheet" href="\.\/css\/foundation\.css">/);
assert.match(html, /class="product-brand"/);
assert.match(html, /class="active-worksite"/);
assert.match(html, /id="obra-switcher"/);
assert.match(html, /id="globalSearch"/);
assert.match(html, /id="darkmodeBtn"/);
assert.match(html, /onclick="doLogout\(\)"/);

for (const page of ["dashboard", "terceirizados", "atacarejo", "frequencia", "efetivo", "empresas", "ata-terc", "ata-atac", "admin"]) {
  assert.match(html, new RegExp(`data-page="${page}"`), `navegação ${page} deve permanecer disponível`);
}

console.log("phase6a-shell: tokens, shell e navegação preservados OK");
