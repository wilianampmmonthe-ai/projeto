"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const mainSource = fs.readFileSync(path.join(__dirname, "..", "js", "main.js"), "utf8");
const assignmentStart = mainSource.indexOf("window.doLogin = async function doLogin() {");
assert.ok(assignmentStart >= 0, "doLogin deve existir");
const functionStart = mainSource.indexOf("async function doLogin()", assignmentStart);
const bodyStart = mainSource.indexOf("{", functionStart);
let depth = 0;
let functionEnd = -1;
for (let index = bodyStart; index < mainSource.length; index += 1) {
  if (mainSource[index] === "{") depth += 1;
  if (mainSource[index] === "}") depth -= 1;
  if (depth === 0) {
    functionEnd = index + 1;
    break;
  }
}
assert.ok(functionEnd > functionStart, "doLogin deve ser extraível");
const functionSource = mainSource.slice(functionStart, functionEnd);

function createHarness({ email = "admin@maxxima.com.br", password = "segredo", loginImpl } = {}) {
  const calls = [];
  const elements = {
    loginUser: { value: email },
    loginPass: { value: password },
    loginSubmit: {
      disabled: false,
      textContent: "Entrar no Sistema",
      attributes: new Map(),
      setAttribute(name, value) { this.attributes.set(name, value); },
      removeAttribute(name) { this.attributes.delete(name); },
    },
  };
  const context = {
    document: { getElementById: (id) => elements[id] || null },
    loginWithEmail: loginImpl || (async (user, pass) => calls.push([user, pass])),
    safeToast: (message, type) => calls.push({ message, type }),
    console: { error: () => {} },
  };
  const doLogin = vm.runInNewContext(`(${functionSource})`, context);
  return { calls, elements, doLogin };
}

(async () => {
  const missing = createHarness({ email: "", password: "" });
  await missing.doLogin();
  assert.equal(missing.calls.length, 1);
  assert.equal(missing.calls[0].type, "error");

  let finishLogin;
  const pending = createHarness({ loginImpl: () => new Promise((resolve) => { finishLogin = resolve; }) });
  const pendingResult = pending.doLogin();
  await Promise.resolve();
  assert.equal(pending.elements.loginSubmit.disabled, true);
  assert.equal(pending.elements.loginSubmit.textContent, "Entrando...");
  assert.equal(pending.elements.loginSubmit.attributes.get("aria-busy"), "true");
  finishLogin();
  await pendingResult;
  assert.equal(pending.elements.loginSubmit.disabled, false);
  assert.equal(pending.elements.loginSubmit.textContent, "Entrar no Sistema");
  assert.equal(pending.elements.loginSubmit.attributes.has("aria-busy"), false);

  const success = createHarness();
  await success.doLogin();
  assert.deepEqual(success.calls[0], ["admin@maxxima.com.br", "segredo"]);

  const invalid = createHarness({ loginImpl: async () => { throw { code: "auth/invalid-credential" }; } });
  await invalid.doLogin();
  assert.equal(invalid.calls.at(-1).type, "error");
  assert.match(invalid.calls.at(-1).message, /senha incorretos/i);
  assert.equal(invalid.elements.loginSubmit.disabled, false);

  console.log("phase6g-login-behavior: vazio, loading, sucesso e credencial invalida OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
