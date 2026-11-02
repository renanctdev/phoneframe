# PhoneFrame

<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.pt-BR.md">Português (Brasil)</a>
</p>

---

**Visualize seu site dentro da moldura de um celular ou tablet de verdade, depois grave e finalize uma demo com qualidade de estúdio, tudo em um único aplicativo desktop.**

O PhoneFrame abre qualquer página web em uma janela com o formato do aparelho que você escolher: moldura, botões laterais, Dynamic Island ou câmera em furo, barra de status e barra de endereço. A página enxerga a largura real do viewport, o User-Agent e o suporte a toque desse aparelho. Ao iniciar a gravação, o PhoneFrame captura a janela do aparelho (já recortada no formato do celular), registra seus toques e abre um editor que adiciona auto-zoom suave, fundos e textos, e depois exporta um MP4.

> Status: versão inicial (`0.1.0`), somente Windows.

## Início rápido

Requisitos: Windows 10/11 (x64), [Node.js](https://nodejs.org/) e npm.

```powershell
git clone https://github.com/renanctdev/phoneframe.git
cd phoneframe/app

npm install
npm start        # executa o app em modo de desenvolvimento
npm run dist     # gera o instalador NSIS e um .exe portátil em ./dist
```

O build gera o `PhoneFrame.exe` (dentro de `dist/win-unpacked`), um instalador e uma versão portátil. Os builds não são assinados digitalmente, então o Windows SmartScreen pode exibir um aviso.

As gravações são salvas em `Vídeos\PhoneFrame\<data e hora>\`. Use **Abrir gravação…** na tela inicial para reabrir uma delas.

## Recursos

**Simulação de aparelhos**
- Catálogo com 25 aparelhos (iPhone, Samsung Galaxy, Google Pixel, Xiaomi, iPad, Galaxy Tab), mais largura e altura personalizadas.
- Tamanho real do viewport em CSS, User-Agent do aparelho, Client Hints coerentes e eventos de toque.
- Moldura desenhada em CSS: borda, tela arredondada, botões laterais, Dynamic Island, notch, câmera em furo, barra de status e barra inferior.
- A janela é reduzida para caber na sua tela, e o site continua enxergando a largura real do aparelho.
- A página roda em um `<webview>` isolado e em sandbox; links que abririam uma nova janela abrem dentro do celular.

**Gravação**
- Captura a própria janela do aparelho (sem recorte manual), junto com o áudio do site.
- Vídeo H.264 e áudio AAC em MP4, com até 60 fps.
- Registra cada toque e o trajeto do cursor, com um indicador de toque visível durante a gravação e o cursor do sistema oculto no vídeo.

**Editor**
- Linha do tempo com as trilhas **Zoom**, **Corte**, **Velocidade** e **Texto**, e forma de onda do áudio.
- Auto-zoom gerado a partir dos seus toques, com uma câmera que acompanha o toque; os zooms também podem ser fixados em um ponto.
- Fundos: degradês, cor sólida ou sua própria imagem, além de margem e sombra.
- Saída: 16:9 ou 9:16, 720p ou 1080p, 30 ou 60 fps. Exportação em MP4 com H.264/AAC.
- Desfazer/refazer, salvamento automático e atalhos de teclado.

## Limitações conhecidas

- Somente Windows x64, por enquanto.
- A exportação é apenas em MP4 (sem GIF).
- Os modos iPhone e iPad emulam largura, User-Agent e toque no Chromium; as páginas não são renderizadas pelo motor do Safari.
- A densidade de pixels (device pixel ratio) não é emulada, e os aparelhos ficam apenas em modo retrato.

As notas de arquitetura (em português) estão em [`app/README.md`](app/README.md).

## Licença

O PhoneFrame é licenciado sob a [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). Se você distribuir o PhoneFrame ou uma versão modificada, deve disponibilizar o código-fonte correspondente sob a mesma licença. Os avisos de terceiros estão em [`NOTICE.md`](NOTICE.md).

## Créditos e agradecimentos

- [**Recordly**](https://github.com/webadderallorg/Recordly), de @webadderall (AGPL-3.0): o auto-zoom, a câmera que acompanha o cursor e as animações de zoom foram portados dele. É por isso que o PhoneFrame é AGPL-3.0. O PhoneFrame é um projeto independente e não usa o nome nem a marca Recordly como seus.
- [**OpenScreen**](https://github.com/siddharthvaddem/openscreen), de Siddharth Vaddem (MIT): o projeto a partir do qual o Recordly foi criado.
- [**Mediabunny**](https://mediabunny.dev), de Vanilagy (MPL-2.0): leitura, codificação e multiplexação de MP4.
- [**Electron**](https://www.electronjs.org/) e Chromium.

---

iPhone, Android, Galaxy e Pixel são marcas registradas de seus respectivos proprietários. O PhoneFrame é um projeto open source independente e não é afiliado a eles nem endossado por eles.
