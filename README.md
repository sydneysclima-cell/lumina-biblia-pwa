# Lumina Bíblia — pacote PWA

O que você precisa colocar no servidor (arquivos + 2 pastas, todos na **mesma pasta**):

```
index.html          ← seu HTML com o bloco PWA adicionado
manifest.json       ← (antes estava colado dentro do HTML, depois de </html>)
sw.js               ← service worker: cache + funcionamento offline
offline.html        ← tela exibida quando não há cache nem internet
icons/              ← ícones do app (192, 512, maskable, apple-touch, favicon)
assets/             ← livros, conteudo, textos off-line, CSS e o app.js (leitor/historias/devocional)
```

Ferramentas auxiliares (não precisam ir para o servidor): `tools/`

---

## O que foi adicionado no `index.html`

**1. `<head>` — arquivos de manifesto e metatags de app**

| Adicionado | Para que serve |
|---|---|
| `<link rel="manifest" href="manifest.json">` | já existia, agora o arquivo existe de verdade |
| `meta name="theme-color"` (claro + escuro) | cor da barra do navegador acompanhando o tema |
| `color-scheme`, `application-name` | barra de rolagem/formulários no tema certo |
| `mobile-web-app-capable` + `apple-mobile-web-app-capable` / `status-bar-style` / `title` | modo app em Android **e** iOS |
| `apple-touch-icon`, `icon` PNG + SVG | ícone na tela inicial e na aba |
| `viewport-fit=cover` | aproveita a área segura (notch / barra do iPhone) |

> Removi `maximum-scale=1.0, user-scalable=no` do viewport: bloquear zoom com pinça é
> um problema de acessibilidade e o Lighthouse marca como erro.

**2. Bloco de script do PWA (fim do `<body>`)**

- Registra `./sw.js` com `scope: './'` e chama `reg.update()` a cada abertura.
- Detecta nova versão (`updatefound`) e mostra um aviso com botão **Recarregar**
  (manda `SKIP_WAITING` para o worker). Não recarrega sozinho no primeiro acesso.
- `beforeinstallprompt` → mostra o botão **Baixar App** que já estava no cabeçalho
  (agora com guarda, para não quebrar se o botão sumir) e chama `prompt()`.
- `appinstalled` → esconde o botão e lembra em `localStorage`.
- **iOS/Safari**: como lá não existe `beforeinstallprompt`, o botão abre o passo a passo
  “Compartilhar → Adicionar à Tela de Início” (`window.pwaInstall()`).
- `online` / `offline` → faixa no topo + aviso flutuante; a verificação repete quando a
  aba volta a ficar visível.
- `index.html?tab=devotional` abre direto a aba devocional — é isso que faz os **atalhos
  longos** (pressione o ícone do app na tela inicial) funcionarem.

**3. CSS novo**: `#pwa-offline-banner`, `#pwa-toast`, `#ios-install-sheet` e ajustes para
`display-mode: standalone`. Os botões do cabeçalho ganharam `flex-wrap`, porque em tela de
390 px a linha já estourava e o botão de instalar ficaria fora da tela.

## `manifest.json`

`name`, `short_name`, `description`, `lang pt-BR`, `start_url ./index.html`, `scope ./`,
`display standalone` (+ `display_override`), cores, 3 ícones (192, 512 e **maskable** 512,
que o Android recorta no formato do launcher) e 3 atalhos longos.

Antes, `theme_color` era `#facc15` (dourado): a Splash Screen e a barra do app ficariam
douradas. Deixei `#090d16`, igual ao fundo do app — é só trocar se preferir o dourado.

## `sw.js` — estratégias de cache

| Requisição | Estratégia |
|---|---|
| Navegação (abrir o app) | rede → cache `index.html` → `offline.html` |
| Fontes (Google Fonts, webfonts do FontAwesome) | cache primeiro (são imutáveis) |
| API da Bíblia (`bible-api.com`, `api.bible`, qualquer `/api/`) | *stale-while-revalidate*: responde na hora com o último capítulo lido e atualiza em segundo plano → **a leitura funciona offline** |
| Resto (CSS/JS/imagens próprios e de CDN) | *stale-while-revalidate*, com teto de 80 entradas |
| `POST`/`PUT` (ex.: salvar um conto) | **nunca** cacheia, só passa direto |

Erros comuns que foram evitados:

- `Promise.allSettled` no pré-cache: um arquivo faltando não derruba a instalação do app.
- Respostas `opaque` (cross-origin sem CORS) são guardadas como estão — reconstruí-las com
  `status: 0` gera `TypeError`.
- `activate` apaga caches de versões antigas (nada de lixo acumulado no celular).
- Ao mudar o `VERSION` (ex.: `v1.0.1`) o cache inteiro é refeito.

## Como testar

```bash
cd lumina-pwa
python3 -m http.server 8000        # http://localhost é "contexto seguro": SW funciona
```

Abra `http://localhost:8000`, depois DevTools → **Application**:
- *Manifest*: deve listar nome, ícones e atalhos, sem erro vermelho.
- *Service Workers*: status `activated and is running`.
- Desmarque *Network → Offline*, leia um capítulo, marque *Offline*, recarregue: o texto
  continua aparecendo (veio do cache) e a faixa âmbar do topo avisa que está sem internet.

Teste automatizado incluído (Chromium real via Playwright):

```bash
python3 -m playwright install chromium
python3 tools/make_icons.py     # se quiser redesenhar os ícones
python3 tools/build_index.py    # regenera o index.html a partir de uploads/index.html
python3 tools/test_pwa.py       # checagens do PWA: registro, manifest, cache, offline, iOS
python3 tools/test_app.py       # checagens do app: livros, historias, devocional, contos, audio
```

## Publicação — nada de PWA sem isto

1. **HTTPS obrigatório** (exceto `localhost`). GitHub Pages, Netlify, Vercel e Cloudflare
   Pages já servem com certificado automático.
2. Os arquivos têm de ficar **na raiz** (ou todos na mesma subpasta) — o `scope` é `./`.
3. `manifest.json` precisa sair com `Content-Type: application/manifest+json` ou
   `application/json` (a maioria dos hosts já faz isso).
4. No **iPhone**, instalar só pelo Safari: Compartilhar → Adicionar à Tela de Início.
5. Se você editar `sw.js` ou os arquivos em cache, **suba o `VERSION`** no topo do `sw.js`,
   senão o navegador continua entregando o cache antigo.

## Leitura, Historias e Devocional (implementados em assets/)

O app agora tem codigo de verdade em `assets/app.js` (+ `books.js`, `content.js`,
`offline-texts.js`, `ui.css`). Pronto para uso:

- **Leitor**: 66 livros / 1189 capitulos (nomes e contagem conferidos na fonte),
  busca por referencia (`Ctrl+K` ou a lupa: `Jo 3:16`, `sl23`, `1 Co 13`), setas
  <- -> trocam de capitulo cruzando o livro, capitulo fica salvo e reabre onde parou.
- **Versoes**: o seletor NVI / ARC / NAA / NVT funciona. Fonte 1: bible-api.com
  (Almeida, dominio publico). Fonte 2 (fallback automatico): pacote completo via
  CDN (jsDelivr) com a versao pedida de verdade — e o que faz NVI/NAA/NVT abrirem
  mesmo quando a 1a fonte nao tem ou esta fora do ar. Se nenhuma das duas entregar
  a versao, o aviso no topo diz qual texto esta sendo exibido.
- **Favoritos e destaques**: estrela no capitulo, toque no versiculo destaca
  (amarelo/verde/azul/rosa), tudo gravado no aparelho e mantido ao recarregar.
- **Audio**: botao Ouvir usa a voz do aparelho (Web Speech, pt-BR), com play/pause,
  anterior/proximo, velocidade 0.75x-1.5x e versiculo acompanhado na tela.
- **Historias**: 14 narrativas (Criacao, Noe, Davi, Jonas, Filho Prodigo, Cruz...)
  com Ouvir, Ler historia e Ler na Biblia (abre o capitulo de origem).
- **Devocional 365**: versiculo do dia (365 referencias validadas, em ordem
  canonica), tema + reflexao + oracao, grade 1-365, marcar concluido, sequencia
  de dias (streak), progresso e compartilhar. Abre no dia de hoje pela data.
- **Contos infantis**: 4 de exemplo + formulario para criar os seus (ficam no
  aparelho, com ouvir/apagar).
- **Tema e Personalizar**: claro/escuro persistido; fundo (7 presets), escurecer,
  borrao, tamanho da letra, entrelinha e modo papel — tudo salvo.

### Offline em 3 camadas
1. Capitulos ja lidos ficam em `localStorage` (ultimos 45) + cache do SW: rele offline.
2. Sem nada lido: 13 capitulos embutidos no app (Gn 1, Sl 23/91, Jo 3/14, Mt 5,
   Rm 8, 1Co 13, Fp 4, Ap 21...) abrem mesmo no primeiro uso sem internet.
3. Sem texto possivel, o aviso explica em vez de travar a tela.

### Regenerar os dados (quando quiser)
```bash
python3 tools/probe_books.py    # (re)confere livros/capitulos na fonte (respeita o limite dela)
python3 tools/build_books.py    # gera assets/books.js + offline-texts.js
python3 tools/fix_verses.py     # valida as 365 refs do devocional localmente (sem rede)
python3 tools/build_index.py    # remonta o index.html
python3 tools/test_app.py       # suite do app (leitor, navegador, devocional...) - Chromium real
```
