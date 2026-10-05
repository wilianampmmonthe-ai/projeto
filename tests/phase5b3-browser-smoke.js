const assert = require("node:assert/strict");

const [port = "9333"] = process.argv.slice(2);

async function main() {
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const tab = tabs.find((item) => item.type === "page");
  if (!tab) throw new Error("Nenhuma página disponível para o smoke test.");
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
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
  const result = await command("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const count = (name) => document.querySelectorAll('script[data-app-dependency="' + name + '"]').length;
      const nav = document.querySelector('[data-page="efetivo"]');
      window.showPage('efetivo', nav);
      const deadline = Date.now() + 15000;
      while ((!window.efetivoInit || !window.Chart) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const effectiveActive = document.getElementById('efetivo-page')?.classList.contains('active');
      const firstCounts = { efetivo: count('efetivo'), chartjs: count('chartjs') };
      await Promise.all([
        window.appDependencies.loadChartJS(),
        window.appDependencies.loadChartJS(),
        window.appDependencies.loadXLSX(),
        window.appDependencies.loadJsPDF(),
        window.appDependencies.loadFirebaseStorage()
      ]);
      const pdf = new window.jspdf.jsPDF();
      pdf.text('Teste lazy jsPDF', 10, 10);
      const pdfBytes = pdf.output('arraybuffer').byteLength;
      const workbook = window.XLSX.utils.book_new();
      const worksheet = window.XLSX.utils.aoa_to_sheet([['Teste'], ['lazy XLSX']]);
      window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Teste');
      const xlsxBytes = window.XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }).byteLength;
      const canvas = document.createElement('canvas');
      const chart = new window.Chart(canvas.getContext('2d'), {
        type: 'line', data: { labels: ['A'], datasets: [{ data: [1] }] }, options: { animation: false }
      });
      chart.update('none');
      chart.destroy();
      window.showPage('dashboard', document.querySelector('[data-page="dashboard"]'));
      window.showPage('efetivo', nav);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        effectiveActive,
        generated: { pdfBytes, xlsxBytes, chartUpdated: true },
        globals: {
          efetivo: typeof window.efetivoInit === 'function',
          Chart: Boolean(window.Chart),
          XLSX: Boolean(window.XLSX),
          jsPDF: Boolean(window.jspdf?.jsPDF),
          firebaseStorage: typeof window.firebase?.storage === 'function'
        },
        firstCounts,
        finalCounts: {
          efetivo: count('efetivo'), chartjs: count('chartjs'), xlsx: count('xlsx'),
          jspdf: count('jspdf'), firebaseStorage: count('firebaseStorage')
        }
      };
    })()`
  });
  socket.close();
  const value = result.result.value;
  assert.equal(value.effectiveActive, true, "o primeiro clique deve manter a aba Efetivo ativa");
  Object.entries(value.globals).forEach(([name, ready]) => assert.equal(ready, true, `${name} deve carregar sob demanda`));
  assert.ok(value.generated.pdfBytes > 500, "jsPDF carregado deve gerar conteúdo real");
  assert.ok(value.generated.xlsxBytes > 1000, "XLSX carregado deve gerar conteúdo real");
  assert.equal(value.generated.chartUpdated, true, "Chart.js deve aceitar update sem recriação");
  Object.entries(value.firstCounts).forEach(([name, count]) => assert.equal(count, 1, `${name} deve ter um único script`));
  Object.entries(value.finalCounts).forEach(([name, count]) => assert.equal(count, 1, `${name} deve ser reutilizado sem duplicação`));
  console.log("FASE 5B.3: lazy loading validado no navegador, sem segundo clique ou scripts duplicados.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
