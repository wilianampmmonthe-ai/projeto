# Performance baseline — Fase 5C

Checkpoint congelado em 05/10/2026 após as fases 5B.1, 5B.2 e 5B.3. Este documento é a referência anterior ao redesign visual. A Fase 5C não introduziu otimizações nem alterou arquitetura, layout, Firestore ou Rules.

## Metodologia

- Edge headless, servidor HTTP local e dependências externas reais.
- Cache do navegador desabilitado pelo Chrome DevTools Protocol.
- Startup medido antes de qualquer navegação para módulos lazy.
- Frequência representativa com 121 colaboradores, 31 dias e 3.751 células.
- Benchmarks: `tests/phase5b1-frequency-benchmark.html` e `tests/phase5b2-render-lifecycle-benchmark.html`.
- Checkpoint integrado: `tests/phase5c-browser-checkpoint.js`.
- Tempos são referências de regressão, não garantias absolutas entre máquinas ou condições de rede diferentes.

Para repetir o checkpoint, sirva a raiz em `http://127.0.0.1:8765`, inicie Edge/Chrome com DevTools remoto na porta `9333` e execute `node tests/phase5c-browser-checkpoint.js 9333 http://127.0.0.1:8765`. O runner falha automaticamente se algum budget determinístico, carregamento único, exceção de browser ou resposta HTTP 4xx/5xx regredir.

## Startup

| Métrica | Baseline final |
|---|---:|
| Requests iniciais | 35 |
| Transferido | 489.024 bytes |
| Decodificado | 1.268.161 bytes |
| Scripts externos | 22 |
| DOMContentLoaded | 1.081,2 ms |
| Load | 1.097,0 ms |
| Primeira tela utilizável (FCP) | 1.076 ms |

O FCP é usado como proxy objetivo para a tela de login utilizável. No startup, `window.jspdf`, `window.XLSX`, `window.Chart`, `efetivoInit` e `firebase.storage` são ausentes. A medição completa está em `tests/phase5b3-startup-after.json`.

## Frequência

| Métrica | Baseline final |
|---|---:|
| Colaboradores | 121 |
| Dias | 31 |
| Células | 3.751 |
| Elementos DOM do benchmark | 11.697 |
| Clique → DOM, mediana | 0,1 ms |
| Clique → DOM, p95 | 0,2 ms |
| Clique → frame | 6,2 ms |
| 50 alterações no DOM | 2,6 ms |
| Maior bloco síncrono observado | 10,0 ms |
| Inclusão de 50 alterações na save queue | 1,397 ms |
| Listeners delegados | 2, um por tabela |
| Persistências para 50 alterações rápidas | 1 operação lógica após debounce |
| Payload | Somente FieldPaths alterados |
| Full renders por marcação comum | 0 |
| GET antes de update normal | 0 |

O debounce permanece em 250 ms na aplicação. Alterações repetidas na mesma célula são colapsadas para o estado final; alterações em células diferentes permanecem no mesmo batch. Pendências são persistidas em `localStorage`, restauradas após reload e reconciliadas sobre snapshots remotos.

### Persistência observada

- Documento existente: `update(FieldPath, valor)` sem `get()` anterior.
- Remoção: `FieldValue.delete()` no FieldPath específico.
- Documento mensal inexistente: fallback mínimo com `set(payloadParcial, { merge: true })`.
- Nunca é enviado o documento mensal inteiro por uma marcação comum.

### Concorrência

- Cliente A alterando célula X e cliente B alterando célula Y: ambos os campos permanecem.
- Dois clientes alterando a mesma célula: last-write-wins, comportamento documentado.
- Snapshot recebido enquanto existe mudança local pendente: a mudança pendente prevalece até confirmação.

## Lifecycle

| Cenário | Antes | Baseline seletivo |
|---|---:|---:|
| Snapshot de funcionários com Dashboard ativo | 4 renders / 4,6 ms | 1 render / 1,9 ms |
| Snapshot de funcionários com Empresas ativa | 4 renders / 4,0 ms | 1 render / 0,7 ms |
| Snapshot de empresas com Frequência ativa | 5 renders / 11,1 ms | 0 renders / 0 ms |
| Snapshot de frequência com Empresas ativa | 0 renders | 0 renders |
| Navegação representativa | 6 renders / 12,7 ms | 5 renders / 10,3 ms |
| 10 snapshots de funcionários | 40 renders / 38 ms | 10 renders / 13 ms |

- Módulos ocultos: zero render.
- Módulo dirty: renderiza uma vez quando ativado.
- Módulo limpo: não renderiza novamente ao reabrir.
- `freqInit()`: idempotente.
- Listeners: não são duplicados na navegação repetida.
- Efetivo oculto: não manipula DOM nem Chart.
- `refreshAll()`: não é chamado pelos listeners normais.

## Lazy loading

| Recurso | Startup | Primeiro uso | Reutilização |
|---|---|---|---|
| jsPDF 2.5.1 | Ausente | Primeiro PDF | Uma tag; mesma instância global |
| XLSX 0.18.5 | Ausente | Primeira importação/exportação Excel | Uma tag |
| Chart.js 4.4.4 | Ausente | Primeira abertura do Efetivo | Uma tag; `chart.update("none")` |
| `efetivo.js` | Ausente | Primeira abertura do Efetivo | Uma tag; estado persistente |
| Firebase Storage | Ausente | Primeiro upload que usa Storage | Uma tag |
| Firebase Realtime Database | Presente | Startup | Mantido por fallback legado ativo |

Chamadas concorrentes compartilham a mesma Promise. Falhas removem a tentativa inválida, afetam somente a funcionalidade dependente e permitem retry. A ação do primeiro clique continua automaticamente após o carregamento.

## Console e network

No fluxo integrado Dashboard → Funcionários → Empresas → Categorias → Frequência → Efetivo → Dashboard → Frequência → Efetivo:

- erros JavaScript próprios: 0;
- exceções não tratadas: 0;
- warnings: 0;
- mensagens informativas: 4;
- respostas HTTP 4xx/5xx: 0;
- scripts lazy duplicados: 0.

## Performance budget

Os limites abaixo valem para benchmark equivalente, cache desabilitado e cardinalidade de referência.

### Startup

- jsPDF, XLSX, Chart.js, Efetivo e Firebase Storage não podem entrar no caminho inicial.
- Scripts externos iniciais: máximo 24.
- Transferido inicial: máximo 600 KB.
- Decodificado inicial: máximo 1,6 MB.
- DOMContentLoaded: máximo 1.500 ms.
- Load: máximo 1.600 ms.
- Primeira tela/FCP: máximo 1.500 ms.

### Frequência

- Clique → DOM p95: menor que 10 ms.
- Clique → frame: menor que 50 ms.
- 50 alterações incrementais no DOM: menor que 25 ms.
- Maior bloco síncrono: menor que 20 ms.
- Full render por marcação comum: exatamente 0.
- GET por marcação comum: exatamente 0.
- Persistência de batch dentro do debounce: uma operação lógica, contendo somente campos alterados.
- Lost updates entre campos independentes: exatamente 0.

### Lifecycle

- Render de módulo oculto por snapshot: exatamente 0.
- Módulo dirty renderiza no máximo uma vez ao ser ativado.
- Módulo limpo não renderiza ao ser reativado.
- Dez snapshots renderizam somente o consumidor visível; consumidores ocultos permanecem em zero.

### Lazy loading e qualidade

- No máximo uma tag por dependência lazy.
- Primeiro uso deve continuar sem segundo clique.
- Falha de CDN não pode derrubar navegação ou módulos independentes.
- Erros JavaScript próprios e HTTP 4xx/5xx no checkpoint integrado: exatamente 0.

## Invariantes

- **PERF-01:** uma marcação comum não pode chamar `freqRender()`.
- **PERF-02:** uma marcação não pode enviar o documento mensal inteiro.
- **PERF-03:** uma marcação não pode fazer GET antes do update normal.
- **PERF-04:** células de Frequência utilizam event delegation.
- **PERF-05:** módulos ocultos não renderizam snapshots.
- **PERF-06:** módulos dirty renderizam somente quando ativados; módulos limpos não renderizam novamente.
- **PERF-07:** jsPDF, XLSX, Chart.js, Efetivo e Firebase Storage permanecem lazy.
- **PERF-08:** alterações concorrentes em campos independentes não podem se apagar.
- **PERF-09:** Efetivo deve reutilizar o Chart com `chart.update("none")` quando possível.
- **PERF-10:** save queue mantém debounce de 250 ms, retry e indicador Salvo/Salvando/Erro.
- **PERF-11:** mudanças pendentes sobrevivem a reload e não são sobrescritas por snapshots.
- **PERF-12:** `freqInit()` e listeners permanecem idempotentes durante navegação repetida.
- **PERF-13:** carregamentos concorrentes compartilham Promise e falhas permitem retry.
- **PERF-14:** `refreshAll()` não pode voltar a ser o caminho normal dos listeners.
- **PERF-15:** Realtime Database não deve ser removido enquanto o fallback legado sem obra ativa existir.

## Matriz do checkpoint

### PASS

- Fase 5B.1: 23 cenários funcionais e benchmark 121 × 31.
- Fase 5B.2: 12 cenários e benchmark seletivo.
- Fase 5B.3: concorrência, retry, falhas isoladas, lazy loading e browser smoke.
- Navegação integrada sem escrita remota.
- Categorias do Efetivo.
- Estrutura e matriz das Firestore Rules.
- PDF real com jsPDF 2.5.1: duas páginas, 24.485 bytes.
- Geração real em memória de PDF e XLSX após lazy loading.
- Sintaxe de todos os arquivos JavaScript.
- `git diff --check` sem erros de whitespace.

### FAIL

Nenhum.

### SKIP

- Sessões reais Admin, Editor e Viewer, logout e troca multiobra: exigem credenciais/fixtures que não estão no repositório.
- Dois navegadores autenticados contra Firestore real: não executado para evitar mutação remota; o contrato de concorrência FieldPath foi validado com dois clientes instrumentados.
- Upload real para Firebase Storage: não executado para evitar gravação remota; carregamento e inicialização do SDK foram validados.

## Critério de comparação futura

Qualquer redesign ou nova funcionalidade que exceda um budget ou quebre uma invariante deve ser tratado como regressão. Variações isoladas de tempo devem ser confirmadas repetindo o mesmo benchmark; presença indevida de bibliotecas no startup, full render por célula, GET mensal ou lost update são falhas determinísticas e não devem ser aceitas.
