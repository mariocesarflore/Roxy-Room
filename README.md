# 🌌 Roxy Room

<p align="center">
  <img src="web/brand/roxyroom-logo.png" alt="Roxy Room Logo" width="120" style="border-radius: 50%; box-shadow: 0 0 30px rgba(99, 102, 241, 0.5);" />
</p>

<p align="center">
  <strong>Streaming P2P de tela e áudio com ultra-baixa latência, aceleração por GPU Direct3D 11 e controles estilo YouTube.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white" alt="Windows" />
  <img src="https://img.shields.io/badge/C%2B%2B-17-00599C?logo=c%2B%2B&logoColor=white" alt="C++17" />
  <img src="https://img.shields.io/badge/Direct3D-11%20GPU-green" alt="Direct3D 11" />
  <img src="https://img.shields.io/badge/P2P-WebRTC%20%2F%20PeerJS-blueviolet" alt="WebRTC" />
  <img src="https://img.shields.io/badge/Updates-Auto--Updater%20Ready-brightgreen" alt="Auto-Updater" />
</p>

---

## ✨ Destaques & Funcionalidades

- 🚀 **Ultra-Baixa Latência (P2P Real):** Conexão direta entre usuários utilizando WebRTC/PeerJS com suporte a STUN/TURN.
- 🎮 **Aceleração por GPU (Direct3D 11):** Decodificação e renderização com 0% de uso desnecessário de CPU.
- 🎛️ **Controles de Player Estilo YouTube:** 
  * Botões minimalistas posicionados nos cantos.
  * Slider de volume horizontal com expansão suave ao passar o cursor (*hover slide-out*).
  * Tag discreta `AO VIVO` com animação de pulso.
  * Auto-ocultação inteligente dos controles e cursor após 2.5s de inatividade.
  * Atalhos no teclado (`Espaço` para pausar, `M` para mutar, `F` para tela cheia e `Setas` para volume).
- 🗗 **Player em Janela Separada / Popout:** Assista a transmissão em janela destacada nativa sem interferir na tela principal.
- 🔊 **Captura de Áudio com Exclusão Seletiva:** Compartilhe o som do jogo ou do sistema permitindo excluir processos específicos (como Discord ou navegadores).
- 🔄 **Auto-Updater Totalmente Integrado:** Qualquer atualização lançada no GitHub é detectada, baixada e aplicada automaticamente para todos os usuários sem necessidade de reinstalação manual.
- 📸 **Captura Instantânea (Screenshot):** Tire prints em alta definição da transmissão direto pelo player.

---

## 📥 Como Baixar e Instalar

1. Acesse a aba **[Releases](https://github.com/mariocesarflore/Roxy-Room/releases)**.
2. Baixe o instalador **`Roxy Room Setup.exe`**.
3. Execute o instalador para ter o atalho na sua Área de Trabalho e Menu Iniciar.
4. *Pronto! As próximas versões serão atualizadas sozinhas pelo próprio aplicativo.*

---

## 🛠️ Compilação e Desenvolvimento

### Pré-requisitos
* **Windows 10 / 11 (64-bit)**
* **Visual Studio 2022+ com C++ Build Tools** (MSVC x64)
* **Python 3.8+** (para os utilitários de empacotamento)

### Compilando o Projeto
```bash
# Compila o executável principal em bin/RoxyRoom.exe
build.bat
```

### Gerando o Instalador e Pacote de Atualização
```bash
# Cria o Roxy Room Setup.exe e o RoxyRoom-Update.zip
python package_update.py 1.0.0 "Descrição das novidades"
```

---

## 👥 Como Usar

1. **Criar ou Entrar em uma Sala:**
   * O aplicativo gera um código de sala (ex: `SALA-6863`).
   * Compartilhe o código com seu amigo para ele se conectar à mesma sala.
2. **Iniciar Transmissão:**
   * Clique em **"Iniciar Transmissão"** ou pressione o atalho **`Alt + G`**.
   * Escolha se deseja compartilhar a tela inteira ou uma janela específica, com ou sem som.
3. **Assistir:**
   * A transmissão aparece automaticamente no palco da sala.
   * Clique com o botão direito na transmissão ou use o botão **D3D11 / Janela Separada** para abrir o player dedicado.

---

## 📄 Licença
Desenvolvido por [Mário César Flore](https://github.com/mariocesarflore). Distribuído sob a licença MIT.
