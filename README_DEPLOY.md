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

- Abra `js/firebase-config.example.js`
- Copie o conteúdo para `js/firebase-config.js`
- Substitua `window.__FIREBASE_CONFIG__ = ...` pelo objeto do seu app web.

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

- `Atacarejo_Igarassu_v2_Acessos.html` (página principal)
- `js/*` (módulos Firebase)
- `vercel.json` (headers básicos)

## 4) Como manter o sistema seguro (checklist)

- **Nunca** colocar usuário/senha no código (removido).
- **Não confiar no front-end**: as regras `firestore.rules`/`storage.rules` bloqueiam escrita para não-admin.
- **XSS**: foi adicionado `escapeHTML()` e aplicado nos pontos mais críticos de renderização com dados do usuário.
- **Uploads**:
  - Arquivos são enviados ao **Firebase Storage**
  - No Firestore ficam apenas metadados (`downloadURL`, `storagePath`, `fileName`) — não `dataURL`.

