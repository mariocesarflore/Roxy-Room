# Plugin Vencord — RoxyRoomScreen (`P2P 1080p60` direto na call do Discord)

Este plugin coloca as transmissões P2P do **Roxy Room** diretamente dentro das chamadas de voz do **Discord (Vencord)**, com **exclusão de áudio do Discord (sem eco da voz dos amigos)** e compatibilidade total com o app externo (`RoxyRoom.exe`) e com o Player Web (`player.html`).

---

## 1. Para instalar no SEU PC e gerar o pacote dos amigos

Basta dar **duplo clique** em:
`vencord-plugin\INSTALAR-PARA-MIM.bat`

(Ou rodar de qualquer pasta: `powershell -ExecutionPolicy Bypass -File "vencord-plugin\instalar-vencord.ps1"`).

O script:
1. Clona e compila o Vencord com o plugin `RoxyRoomScreen` embutido.
2. Instala automaticamente no seu Discord (`%APPDATA%\Vencord\dist`), copia o `RoxyAudioHelper.exe` e já ativa o plugin.
3. Gera o arquivo pronto para enviar aos seus amigos:
   **`vencord-plugin\RoxyVencord-Amigos.zip`**

---

## 2. O que enviar para seus amigos

Envie apenas o arquivo **`RoxyVencord-Amigos.zip`** (ele fica super leve e não exige que seu amigo tenha Git, Node ou conhecimento técnico!).

Instruções para o amigo:
1. Extrair o `RoxyVencord-Amigos.zip` em uma pasta.
2. Dar duplo clique em **`INSTALAR.bat`**.
3. Confirmar fechar o Discord (se estiver aberto) e abrir o Discord novamente.

> O pacote ja inclui o instalador oficial do Vencord embutido (`VencordInstallerCli.exe`), verifica sempre a versao mais recente do Discord instalada, desativa o `autoUpdate` do Vencord (para ele nao sobrescrever o plugin), ativa o `RoxyRoomScreen` automaticamente e instala o filtro anti-eco de audio.

---

## 3. Como usar na call

- Entre em uma call de voz no Discord: o painel **ROXY P2P** aparece na tela da call (sala automática `DC-<ID_DO_CANAL>`) e o botão **Roxy** aparece no canto inferior esquerdo.
- **Amigo sem Vencord nem app:** clique em **Link Web** no painel para enviar o link do navegador (`player.html?room=...`).
- **Amigo usando o `RoxyRoom.exe` por fora:** ele clica no botão **`Usar sala: <Nome da Call>`** no app (ou cola o código `DC-...`).

---

## 4. Interface estilo Discord

O seletor de transmissão segue o visual nativo do Discord:

- Abas **Aplicativos**, **Tela Inteira** e **Dispositivos** (webcam), com miniatura e ícone de cada fonte.
- Rodapé com o preset **SD** (720p 30fps) / **HD** (1080p 60fps), engrenagem para FPS, resolução, bitrate, áudio e sala, e faixa de destaque roxa.
- Na call, cada transmissão aparece como card com selo **AO VIVO**, qualidade (`1080p 60fps`), nome do streamer e, ao passar o mouse, a barra de controles.

## 5. Controles de quem assiste

Ao passar o mouse sobre uma transmissão recebida, a barra inferior oferece:

- **Mudo** da transmissão (só afeta o seu áudio, a call continua normal).
- **Volume** com slider que expande no hover, de 0 a 100%, com o valor aplicado em tempo real.
- **Ampliar/grade**, **Picture-in-Picture**, **tela cheia** (ou duplo clique) e **fechar** a visualização.

## 6. Áudio sem eco

O `RoxyAudioHelper.exe` captura o som do PC com **exclusão da árvore de processos do Discord**, então a voz das pessoas na call não volta pela transmissão. Se o Discord reiniciar no meio do stream, o helper reencontra o novo processo em até 5 segundos e retoma a captura já com a exclusão correta.
