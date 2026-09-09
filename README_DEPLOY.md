# Deploy seguro (Firebase + Vercel)

## 1) Criar e configurar o Firebase

- **Criar projeto** no Firebase Console.
- Em **Authentication**:
  - **Sign-in method**: habilite **Email/Password**.
  - Em **Users**: crie o(s) usuário(s) (e-mail/senha) que vão acessar o sistema.
- Em **Firestore Database**:
  - Crie o banco (modo produção).
  - Em **Rules**, cole o conteúdo de `firestore.rules` e publique.
  - Para definir um admin:
    - Vá em **Firestore -> Data** e crie a coleção `admins`.
    - Crie um documento com **ID = UID** do usuário admin (Auth -> Users mostra o UID).
    - Conteúdo pode ser `{ "enabled": true }`.
- Em **Storage**:
  - Ative o Storage.
  - Em **Rules**, cole o conteúdo de `storage.rules` e publique.

## 2) Onde colocar as chaves (config do Firebase)

No front-end, a “config do Firebase” **não é segredo** (diferente de service account).
Mesmo assim, a segurança deve vir de:

- **Authentication**
- **Regras do Firestore**
- **Regras do Storage**

Passos:

- Abra `js/config/firebase-config.example.js`
- Copie o conteudo para `js/config/firebase-config.js`
- Substitua `window.__FIREBASE_CONFIG__ = ...` pelo objeto do seu app web.
- Nao coloque service accounts, chaves privadas ou credenciais administrativas nesse arquivo.

Você pega esse objeto em:

- Firebase Console -> **Project settings** -> **Your apps** -> **Web app** -> **SDK setup and configuration**

## 3) Deploy na Vercel (sem backend)

Como seu projeto é HTML/JS/CSS estático:

- Suba os arquivos para um repositório (GitHub/GitLab) **ou** faça upload manual.
- Na Vercel:
  - **Framework Preset**: “Other”
  - **Build Command**: vazio
  - **Output Directory**: vazio (raiz)

Arquivos importantes:

- `index.html` (pagina principal)
- `css/*` (estilos separados por responsabilidade)
- `js/config/*` (configuracao e inicializacao Firebase)
- `js/services/*` (servicos globais de Auth e banco)
- `js/modules/efetivo.js` e `css/efetivo.css` (modulo de controle de efetivo mensal)
- `js/main.js` (logica principal atual do sistema)
- `vercel.json` (headers basicos)

## Estrutura do Projeto

- `assets`: imagens, icones e demais arquivos estaticos.
- `css`: estilos da aplicacao separados em base, layout, componentes, paginas, frequencia e impressao.
- `js/config`: configuracao web e inicializacao do Firebase.
- `js/services`: servicos globais de autenticacao e acesso ao banco.
- `js/modules`: area reservada para modularizar telas como dashboard, funcionarios, empresas, frequencia, efetivo, atas e admin.
- `js/utils`: funcoes utilitarias compartilhadas, como formatadores, validadores, permissoes e exportacao.
- `firestore.rules`: regras de seguranca do Firestore.
- `storage.rules`: regras de seguranca do Firebase Storage.
- `vercel.json`: configuracao de deploy estatico e headers na Vercel.

## Estrutura Firebase usada pelo sistema

Colecoes raiz legadas:

- `usuarios/{uid}`
- `obra/{docId}`
- `funcionarios/{docId}`
- `empresas/{docId}`
- `frequencia/{YYYY-MM}`

Estrutura multiobra:

- `obras/{obraId}`
- `obras/{obraId}/funcionarios/{docId}`
- `obras/{obraId}/empresas/{docId}`
- `obras/{obraId}/frequencia/{YYYY-MM}`
- `obras/{obraId}/efetivo/{YYYY-MM}`
- `obras/{obraId}/efetivoConfig/categorias`
- `obras/{obraId}/efetivoImportacoes/{importId}`

No modulo Efetivo, viewers podem visualizar os consolidados da obra ativa. Editors e admins podem importar CSV/XLSX, editar valores manualmente e salvar o consolidado mensal.

## 4) Como manter o sistema seguro (checklist)

- **Nunca** colocar usuário/senha no código (removido).
- **Não confiar no front-end**: as regras `firestore.rules`/`storage.rules` bloqueiam escrita para não-admin.
- **XSS**: foi adicionado `escapeHTML()` e aplicado nos pontos mais críticos de renderização com dados do usuário.
- **Uploads**:
  - Arquivos são enviados ao **Firebase Storage**
  - No Firestore ficam apenas metadados (`downloadURL`, `storagePath`, `fileName`) — não `dataURL`.

