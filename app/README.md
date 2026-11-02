# PhoneFrame: notas de arquitetura

Este arquivo descreve como o app funciona por dentro (em português). Para
instalar, usar e contribuir, veja o [README principal](../README.md).

App Electron para Windows. Você escolhe um aparelho, digita a URL e abre uma
janela que tem o próprio formato do celular: sem a moldura do Windows, com
fundo transparente e o navegador do aparelho (barra de status, barra de
endereço e barra inferior) desenhado dentro dele.

## Como funciona

- `src/main/main.js`: processo principal. Abre o seletor e a janela do
  aparelho (`frame: false`, `transparent: true`). A janela é desenhada no
  tamanho real e reduzida com `zoomFactor` quando não cabe na tela. O site
  também recebe o mesmo zoom, então continua vendo a largura real do aparelho
  (ex.: 402px no iPhone 18 Pro).
- `src/main/deviceCatalog.js`: aparelhos com viewport, raio da tela, bezel,
  tipo de notch e User-Agent.
- `src/shared/deviceGeometry.js`: medidas da moldura e das barras, usadas pelo
  processo principal e pelos renderers.
- `src/renderer/device-shell/`: o celular (aro, botões laterais, Dynamic
  Island/notch/câmera, barra de status com hora, barra de endereço, `<webview>`
  com o site, barra inferior e indicador de home).
- `src/renderer/picker/`: tela inicial de escolha do aparelho e da URL.
- `src/main/recording.js` + `src/renderer/recbar/`: gravação. A barrinha ao
  lado do celular captura a janela do celular (`getMediaSourceId`) e o áudio do
  `<webview>` (com o som continuando nas caixas) e grava direto em MP4
  (WebCodecs: H.264 + AAC, `raw.mp4` fragmentado). Cada quadro usa o horário
  em que foi capturado, então os cliques de `telemetry.json` (mouse ~60 Hz)
  ficam alinhados com o vídeo (diferença medida: 0 a 24 ms).
- `src/main/guest-select-popup.js`: o menu nativo de `<select>` é uma janela
  do Windows e não aparece na captura. Por isso o script é injetado no site
  (a cada `dom-ready`) e desenha um menu próprio. `<select multiple>` e
  `<select size>` continuam nativos.
- `src/renderer/overlay/`: círculo de toque que você vê enquanto grava. Ele
  fica numa janela à parte, que não entra na captura; o cursor do Windows fica
  oculto sobre o celular durante a gravação.
- `src/main/projects.js` + `src/renderer/editor/`: editor. Converte a gravação
  para MP4 (sem recodificar), cria os zooms automáticos a partir dos toques e
  exporta o vídeo final com WebCodecs (H.264 + AAC) via Mediabunny.
  - `motion/recordly.js` e `motion/zoomSuggestions.js`: zoom automático,
    câmera que acompanha o toque e molas, portados do Recordly (AGPL-3.0).
  - `compositor.js`: monta cada quadro (fundo, sombra, celular recortado no
    formato do aparelho, zoom, toque, textos). A prévia e a exportação usam o
    mesmo código.
  - `timeline.js`, `inspector.js`, `timeMap.js`, `exporter.js`, `media.js`.

O site roda num `<webview>` isolado: sem Node, sem preload, com sandbox,
permissões negadas e partição própria (`persist:simulador`). Links que abririam
nova janela abrem no próprio celular. Os cabeçalhos HTTP usam o User-Agent do
aparelho. No Android, os Client Hints são enviados como mobile; no iOS, são
removidos, como acontece no Safari.

## Uso

- Arraste o celular pela moldura ou pela barra de status.
- Barra de endereço: clique, digite a URL e pressione Enter.
- Barra inferior: voltar, avançar, recarregar, trocar de aparelho e fechar
  o app.

### Gravar

1. Clique no botão vermelho da barrinha ao lado do celular. Conta 3, 2, 1 e
   começa a gravar.
2. Use o site normalmente. Cada toque vira um ponto de zoom.
3. Clique no quadrado vermelho para parar. O editor abre sozinho.

As gravações ficam em `Vídeos\PhoneFrame\<data e hora>\` (o ícone de
pasta da barrinha abre esse lugar). Fechar o celular no meio da gravação salva
o vídeo antes. Para reabrir uma gravação: botão "Abrir gravação…" na tela
inicial.

### Editar

- Prévia em 16:9 (horizontal) ou 9:16 (vertical), 720p ou 1080p, 30 ou 60 fps.
- Linha do tempo com trilhas de **Zoom**, **Corte**, **Velocidade** e
  **Texto**, mais a forma de onda do áudio do site. Os pontos amarelos na
  régua são os toques gravados.
  - Clique duplo numa trilha (ou os botões "+") cria uma região.
  - Arraste para mover; arraste as bordas para mudar a duração.
  - Ctrl+roda do mouse aproxima/afasta a linha do tempo.
- Zoom: intensidade, "segue o toque" ou "ponto fixo" (clique na prévia para
  posicionar). Zooms tracejados são automáticos; ao editar, viram manuais.
  O zoom automático começa 700 ms antes do primeiro toque. Projetos antigos
  mantêm os zooms antigos: use "Gerar zooms automáticos" para refazer.
- Nitidez: controle "Nitidez" no inspetor (padrão 0,5; 0 desliga).
- Fundo (degradês, cor sólida ou imagem), margem, sombra, tamanho e cor do
  toque, volume do áudio.
- Atalhos: Espaço reproduz/pausa, ←/→ um quadro (Shift: 1 s), Delete apaga a
  região selecionada, Ctrl+Z / Ctrl+Y desfazem e refazem, Ctrl+E exporta.
- O projeto é salvo sozinho em `project.json`.

## Rodando

```powershell
npm install
npm start      # desenvolvimento
npm run dist   # instalador NSIS + versão portátil em ../dist
```

`npm run dist` grava nome, descrição e copyright no `PhoneFrame.exe` com o
hook `scripts/after-pack.js` (pacote `rcedit`). O `electron-builder` faria isso
sozinho, mas a ferramenta que ele baixa para isso (`winCodeSign`) só extrai no
Windows com privilégio de administrador ou modo de desenvolvedor.
`LICENSE` e `NOTICE.md` ficam na raiz do repositório e são copiados para a
pasta `resources` da instalação.

## Limitações

- A nitidez do vídeo depende do tamanho do celular na tela: num monitor
  1366×768 o celular é capturado com ~330×680 px, então o zoom amplia esses
  pixels. Por isso o zoom padrão é 1,5×.
- A captura só gera quadros quando a tela muda (até 60 por segundo); trechos
  parados ficam com o último quadro, o que é normal.
- A moldura é desenhada em CSS; o app não usa imagens de aparelhos.
- A emulação ajusta largura, User-Agent e suporte a toque. Ela não substitui
  o motor do Safari: no modo iPhone, o site continua sendo renderizado pelo
  Chromium.

## Licença

AGPL-3.0-only (arquivo `LICENSE` na raiz do repositório), porque o zoom
automático e as animações foram portados do
[Recordly](https://github.com/webadderallorg/Recordly). Créditos completos em
`NOTICE.md` e na tela "Sobre" do editor.
