<div align="center">

  <br />

  <a href="https://github.com/mariocesarflore/Roxy-Room">
    <img src="web/brand/roxyroom-logo.png" alt="Roxy Room Logo" width="135" style="border-radius: 50%; box-shadow: 0 0 45px rgba(139, 92, 246, 0.6); border: 2px solid rgba(255, 255, 255, 0.1);" />
  </a>

  <h1 align="center" style="font-weight: 800; font-size: 2.4rem; letter-spacing: -0.5px; margin-top: 15px;">
    🌌 ROXY ROOM
  </h1>

  <p align="center">
    <a href="https://github.com/mariocesarflore/Roxy-Room">
      <img src="https://readme-typing-svg.demolab.com?font=Plus+Jakarta+Sans&weight=700&size=20&duration=2800&pause=1100&color=A78BFA&center=true&vCenter=true&width=550&lines=Streaming+P2P+de+Tela+e+%C3%81udio+Sem+Delay;Acelera%C3%A7%C3%A3o+Nativa+por+GPU+Direct3D+11;Player+Minimalista+Moderno+Estilo+YouTube;Atualiza%C3%A7%C3%B5es+Autom%C3%A1ticas+Zero-Install" alt="Typing Tagline" />
    </a>
  </p>

  <p align="center">
    <strong>Compartilhamento de tela e áudio entre amigos com foco total em ultra-baixa latência, leveza e privacidade.</strong>
  </p>

  <!-- Badges Primários -->
  <p align="center">
    <a href="https://github.com/mariocesarflore/Roxy-Room/releases/latest">
      <img src="https://img.shields.io/github/v/release/mariocesarflore/Roxy-Room?color=8B5CF6&label=Vers%C3%A3o%20Est%C3%A1vel&logo=github&style=for-the-badge" alt="Versão Atual" />
    </a>
    <a href="https://github.com/mariocesarflore/Roxy-Room/releases">
      <img src="https://img.shields.io/github/downloads/mariocesarflore/Roxy-Room/total?color=10B981&label=Downloads&logo=windows&style=for-the-badge" alt="Total de Downloads" />
    </a>
    <a href="#-licença--termos-de-uso">
      <img src="https://img.shields.io/badge/Licen%C3%A7a-MIT-3B82F6?style=for-the-badge&logo=open-source-initiative&logoColor=white" alt="Licença MIT" />
    </a>
  </p>

  <!-- Badges Tecnologias -->
  <p align="center">
    <img src="https://img.shields.io/badge/Windows-10%20%7C%2011%20(64--bit)-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows" />
    <img src="https://img.shields.io/badge/C%2B%2B-17%20(MSVC%20Native)-00599C?style=flat-square&logo=c%2B%2B&logoColor=white" alt="C++17" />
    <img src="https://img.shields.io/badge/GPU-Direct3D%2011%20Rendering-10B981?style=flat-square" alt="Direct3D 11" />
    <img src="https://img.shields.io/badge/Rede-WebRTC%20P2P%20Direct-7C3AED?style=flat-square&logo=webrtc&logoColor=white" alt="WebRTC" />
    <img src="https://img.shields.io/badge/Auto--Updater-Nativo%20em%20C%2B%2B-EC4899?style=flat-square" alt="Auto-Updater" />
  </p>

  <br />

  <!-- Botão de Download Principal -->
  <p align="center">
    <a href="https://github.com/mariocesarflore/Roxy-Room/releases/latest/download/Roxy.Room.Setup.exe">
      <img src="https://img.shields.io/badge/%E2%96%B6%20BAIXAR%20INSTALADOR%20OFICIAL-Roxy.Room.Setup.exe-6366F1?style=for-the-badge&logo=windows&logoColor=white" height="42" alt="Download Roxy Room" />
    </a>
  </p>

  <br />

</div>

---

## 📑 Navegação Rápida

<p align="center">
  <a href="#-por-que-o-roxy-room"><b>Por Que o Roxy Room?</b></a> •
  <a href="#-principais-recursos"><b>Recursos</b></a> •
  <a href="#-player-minimalista-estilo-youtube"><b>Player Estilo YouTube</b></a> •
  <a href="#-atalhos-de-teclado"><b>Atalhos</b></a> •
  <a href="#-sistema-de-atualização-automática"><b>Auto-Update</b></a> •
  <a href="#-como-usar"><b>Como Usar</b></a> •
  <a href="#-licença--termos-de-uso"><b>Licença</b></a>
</p>

---

## 💡 Por Que o Roxy Room?

Enquanto programas tradicionais enviam todo o tráfego de vídeo para servidores centrais de empresas terceiras (adicionando filas, compressões pesadas e atrasos visíveis), o **Roxy Room** estabelece um **túnel direto P2P** entre os computadores:

```mermaid
flowchart LR
    subgraph Tradicional["❌ Softwares Tradicionais (Alto Delay)"]
        direction LR
        U1["Seu Computador"] -->|"Vídeo Comprimido"| S["Servidor Central em Nuvem\n(Gargalo de Banda)"]
        S -->|"Atraso de 400ms~1500ms"| U2["Amigo Assistindo"]
    end

    subgraph Roxy["⚡ Roxy Room (Túnel P2P Direto)"]
        direction LR
        P1["Seu Computador\n(DXGI Capture)"] ====>|"WebRTC Direto (0-15ms de Latência)\nAceleração GPU Direct3D 11"| P2["Amigo Assistindo\n(Player YouTube Estilo)"]
    end
```

---

## ✨ Principais Recursos

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🚀 Ultra-Baixa Latência (P2P Puro)</h3>
      <p>Conexão direta ponta-a-ponta via WebRTC. O vídeo viaja em milissegundos pela rede sem intermediários ou perda de taxa de quadros.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎮 Aceleração por GPU Direct3D 11</h3>
      <p>Renderização com hardware nativo da placa de vídeo. Mantém 60 FPS lisos durante jogos pesados com 0% de uso de CPU.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🎛️ Player Estilo YouTube</h3>
      <p>Controles discretos posicionados nos cantos, slider de volume deslizante com expansão suave, tag <code>AO VIVO</code> e auto-hide inteligente.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔊 Captura Seletiva de Áudio</h3>
      <p>Compartilhe o som de alta definição do jogo via Windows WASAPI Loopback, com suporte para isolar ou excluir sons indesejados.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🗗 Janela Separada / Popout</h3>
      <p>Destaque qualquer transmissão da sala em uma janela flutuante independente para assistir em um segundo monitor com facilidade.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔄 Auto-Updater Integrado</h3>
      <p>Sem necessidade de reinstalação manual: novas versões lançadas são detectadas, baixadas e aplicadas automaticamente.</p>
    </td>
  </tr>
</table>

---

## 🎬 Player Minimalista Estilo YouTube

Inspirado na experiência fluida do YouTube, o player do Roxy Room foi desenhado para manter o foco total no vídeo, posicionando os controles de forma sutil e inteligente nos cantos:

<table>
  <tr>
    <td width="33%" align="center">
      <h3>🕹️ Controles de Mídia</h3>
      <p>Alternância instantânea de Play / Pause com feedback suave e sem atrasos.</p>
    </td>
    <td width="33%" align="center">
      <h3>🔊 Volume Deslizante</h3>
      <p>Controle horizontal retrátil que se expande suavemente ao passar o cursor (<em>hover slide-out</em>).</p>
    </td>
    <td width="33%" align="center">
      <h3>🔴 Chip Ao Vivo</h3>
      <p>Indicador discreto de transmissão em tempo real com efeito de pulso luminoso.</p>
    </td>
  </tr>
  <tr>
    <td width="33%" align="center">
      <h3>📸 Captura Instantânea</h3>
      <p>Tire prints em alta definição direto da transmissão com apenas um clique.</p>
    </td>
    <td width="33%" align="center">
      <h3>🗗 Janela Popout</h3>
      <p>Destaque a transmissão em uma janela separada nativa para outro monitor.</p>
    </td>
    <td width="33%" align="center">
      <h3>✨ Auto-Ocultação</h3>
      <p>Controles e cursor somem após 2.5s de inatividade e ressurgem ao mover o mouse.</p>
    </td>
  </tr>
</table>

---

## ⌨️ Atalhos de Teclado

Controle tudo sem precisar encostar o cursor na tela:

| Tecla / Atalho | Ação Executada |
| :---: | :--- |
| <kbd>Espaço</kbd> ou <kbd>K</kbd> | Alternar entre Pausar e Retomar o vídeo |
| <kbd>M</kbd> | Mutar / Desmutar o áudio da transmissão |
| <kbd>F</kbd> | Entrar ou Sair do modo **Tela Cheia** |
| <kbd>↑</kbd> *(Seta Cima)* | Aumentar o volume (+5%) |
| <kbd>↓</kbd> *(Seta Baixo)* | Diminuir o volume (-5%) |
| <kbd>Esc</kbd> | Fechar tela cheia / Fechar o player |
| <kbd>Alt</kbd> + <kbd>G</kbd> | **Iniciar / Encerrar Transmissão** de qualquer lugar no Windows |

---

## 🔄 Sistema de Atualização Automática

O Roxy Room possui um motor nativo de **Zero-Install Auto-Update**:

```mermaid
flowchart TD
    Start(["⚡ Inicialização do Roxy Room"]) --> Check{"Verifica GitHub\nversion.json"}
    Check -- "Versão Mais Recente" --> OK["✅ Abre Diretamente sem Interrupções"]
    Check -- "Nova Versão Detectada" --> Notify["🔔 Notifica o Usuário com Novidades"]
    Notify --> Download["📦 Baixa RoxyRoom-Update.zip em Segundo Plano"]
    Download --> Apply["🔄 Aplica Arquivos e Reinicia o Aplicativo"]
    Apply --> Done(["🎉 Roxy Room Atualizado com Sucesso!"])
```

- A verificação ocorre de forma transparente ao iniciar o app e periodicamente a cada 45 minutos.
- O download ocorre em segundo plano sem congelar a tela.

---

## 👥 Como Usar

### 1. Instalação (Rápida em 1 Clique)
1. Baixe o instalador oficial **[`Roxy.Room.Setup.exe`](https://github.com/mariocesarflore/Roxy-Room/releases/latest/download/Roxy.Room.Setup.exe)**.
2. Execute o instalador para criar os atalhos na Área de Trabalho e no Menu Iniciar.

### 2. Entrar ou Criar uma Sala
1. Abra o **Roxy Room**.
2. Copie o seu código da sala (ex: `SALA-7421`) e envie para seu amigo.
3. Seu amigo digita o código e clica em **Conectar**.

### 3. Transmitir e Assistir
1. Pressione o atalho global **<kbd>Alt + G</kbd>** ou clique no botão **"Iniciar Transmissão"**.
2. Escolha sua tela cheia ou aplicativo específico com áudio ativado.
3. A transmissão é exibida automaticamente para quem estiver na sala com qualidade máxima e som cristalino.

---

## 🛠️ Compilação e Desenvolvimento Local

Para desenvolvedores que desejam compilar o projeto do zero:

```bash
# 1. Clone o repositório
git clone https://github.com/mariocesarflore/Roxy-Room.git
cd Roxy-Room

# 2. Compile o executável nativo em C++ (bin/RoxyRoom.exe)
tools\build.bat

# 3. Empacotar uma nova release com instalador
python tools/package_release.py 1.0.1 "Correções e melhorias"
```

---

## 📄 Licença & Termos de Uso

Este projeto está registrado e protegido sob os termos da **[Licença MIT](LICENSE)**.

<div align="center">

| Permissões Oficiais | Condições | Limitações Legais |
| :---: | :---: | :---: |
| ✅ **Uso Comercial** | ℹ️ Preservação dos avisos de Copyright e Licença | ❌ Nenhuma Garantia de Software |
| ✅ **Modificação do Código** | | ❌ Isenção Total de Responsabilidade |
| ✅ **Distribuição Gratuita** | | |
| ✅ **Uso Pessoal e Privado** | | |

<br />

<p>
  Desenvolvido com carinho e dedicação por <strong><a href="https://github.com/mariocesarflore">Mário César Flore</a></strong> 🚀
</p>

<p>
  <a href="https://github.com/mariocesarflore/Roxy-Room">
    <img src="https://img.shields.io/github/stars/mariocesarflore/Roxy-Room?style=social" alt="GitHub Stars" />
  </a>
  &nbsp;
  <a href="https://github.com/mariocesarflore/Roxy-Room/fork">
    <img src="https://img.shields.io/github/forks/mariocesarflore/Roxy-Room?style=social" alt="GitHub Forks" />
  </a>
</p>

</div>
