"use strict";

const assert = require("node:assert/strict");
const [port = "9335", baseUrl = "http://127.0.0.1:8765", repetitionsArg = "9"] = process.argv.slice(2);
const repetitions = Math.max(3, Number(repetitionsArg) || 9);

function percentile(values, ratio) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function main() {
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const tab = tabs.find((item) => item.type === "page");
  if (!tab) throw new Error("Nenhuma pagina disponivel para benchmark.");

  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  let loadResolver;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    } else if (message.method === "Page.loadEventFired" && loadResolver) {
      loadResolver();
      loadResolver = null;
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const command = (method, params = {}) => {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const evaluate = async (expression) => {
    const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };

  await command("Page.enable");
  await command("Page.bringToFront");
  await command("Emulation.setFocusEmulationEnabled", { enabled: true });
  const samples = [];
  for (let index = 0; index < repetitions; index += 1) {
    await command("Page.bringToFront");
    const loaded = new Promise((resolve) => { loadResolver = resolve; });
    await command("Page.navigate", { url: `${baseUrl}/tests/phase5b1-frequency-benchmark.html?run=${index}` });
    await loaded;
    const sample = await evaluate(`(async () => {
      const deadline = Date.now() + 10000;
      while (document.getElementById('result')?.textContent === 'running' && Date.now() < deadline) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return JSON.parse(document.getElementById('result').textContent);
    })()`);
    assert.equal(sample.fullRendersPerCell, 0);
    assert.equal(sample.delegatedListeners, 2);
    assert.ok(sample.clickToDomP95Ms < 10);
    sample.steadyStateClickToFrameMs = await evaluate(`(async () => {
      const cell = document.querySelector('.freq-cell[data-tipo="terceirizados"][data-fid="70"][data-dia="15"]');
      const row = cell.closest('tr');
      const rowCells = [...row.querySelectorAll('.freq-cell')];
      const rowTotal = row.lastElementChild;
      const table = cell.closest('table');
      const dayCells = [...table.querySelectorAll('.freq-cell[data-dia="15"]')];
      const footerCells = [...table.querySelectorAll('tfoot td')];
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const start = performance.now();
      cell.className = 'freq-cell st-Trabalhado';
      cell.dataset.status = 'Trabalhado';
      cell.textContent = '1';
      rowTotal.textContent = String(rowCells.reduce((sum, item) => sum + (item.dataset.status === 'Trabalhado' ? 1 : 0), 0));
      footerCells[14].textContent = String(dayCells.reduce((sum, item) => sum + (item.dataset.status === 'Trabalhado' ? 1 : 0), 0));
      footerCells.at(-1).textContent = String(footerCells.slice(0, 31).reduce((sum, item) => sum + (Number(item.textContent) || 0), 0));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return Number((performance.now() - start).toFixed(3));
    })()`);
    samples.push(sample);
  }
  socket.close();

  const paint = samples.map((sample) => sample.clickToPaintMs);
  const summary = {
    status: "ok",
    repetitions,
    initialPageClickToFrameMs: {
      values: paint,
      median: percentile(paint, 0.5),
      p95: percentile(paint, 0.95),
      min: Math.min(...paint),
      max: Math.max(...paint),
      withinBudget: paint.filter((value) => value < 50).length,
      outliers: paint.filter((value) => value >= 50),
    },
    steadyStateClickToFrameMs: {
      values: samples.map((sample) => sample.steadyStateClickToFrameMs),
      median: percentile(samples.map((sample) => sample.steadyStateClickToFrameMs), 0.5),
      p95: percentile(samples.map((sample) => sample.steadyStateClickToFrameMs), 0.95),
      min: Math.min(...samples.map((sample) => sample.steadyStateClickToFrameMs)),
      max: Math.max(...samples.map((sample) => sample.steadyStateClickToFrameMs)),
    },
    clickToDomP95Ms: {
      median: percentile(samples.map((sample) => sample.clickToDomP95Ms), 0.5),
      p95: percentile(samples.map((sample) => sample.clickToDomP95Ms), 0.95),
    },
    changes50Ms: {
      median: percentile(samples.map((sample) => sample.changes50Ms), 0.5),
      p95: percentile(samples.map((sample) => sample.changes50Ms), 0.95),
    },
    largestSynchronousBlockMs: {
      median: percentile(samples.map((sample) => sample.largestSynchronousBlockMs), 0.5),
      p95: percentile(samples.map((sample) => sample.largestSynchronousBlockMs), 0.95),
    },
  };
  console.log(JSON.stringify(summary, null, 2));
  assert.ok(summary.steadyStateClickToFrameMs.median < 50, `mediana clique-frame estável excedeu 50 ms: ${summary.steadyStateClickToFrameMs.median}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
