<div align="center">

  <br />

  <a href="https://github.com/mariocesarflore/Roxy-Room">
    <img src="web/brand/roxyroom-logo.png" alt="Roxy Room Logo" width="130" style="border-radius: 50%; box-shadow: 0 0 35px rgba(99, 102, 241, 0.4); border: 1px solid rgba(255, 255, 255, 0.1);" />
  </a>

  <h1 align="center" style="font-weight: 800; font-size: 2.3rem; letter-spacing: -0.5px; margin-top: 15px;">
    Roxy Room
  </h1>

  <p align="center">
    <a href="https://github.com/mariocesarflore/Roxy-Room">
      <img src="https://readme-typing-svg.demolab.com?font=Plus+Jakarta+Sans&weight=700&size=20&duration=2800&pause=1100&color=818CF8&center=true&vCenter=true&width=550&lines=Streaming+P2P+de+Tela+e+%C3%81udio+Sem+Delay;Acelera%C3%A7%C3%A3o+Nativa+por+GPU+Direct3D+11;Player+Minimalista+Moderno+Estilo+YouTube;Atualiza%C3%A7%C3%B5es+Autom%C3%A1ticas+Integradas" alt="Typing Tagline" />
    </a>
  </p>

  <p align="center">
    <strong>Compartilhamento de tela e áudio peer-to-peer de alta fidelidade com aceleração de hardware e baixa latência.</strong>
  </p>

  <!-- Badges -->
  <p align="center">
    <a href="https://github.com/mariocesarflore/Roxy-Room/releases/latest">
      <img src="https://img.shields.io/github/v/release/mariocesarflore/Roxy-Room?color=6366F1&label=Release&logo=github&style=flat-square" alt="Versão Atual" />
    </a>
    <a href="https://github.com/mariocesarflore/Roxy-Room/releases">
      <img src="https://img.shields.io/github/downloads/mariocesarflore/Roxy-Room/total?color=10B981&label=Downloads&logo=windows&style=flat-square" alt="Total de Downloads" />
    </a>
    <a href="#licença-e-termos-de-uso">
      <img src="https://img.shields.io/badge/Licença-MIT-3B82F6?style=flat-square" alt="Licença MIT" />
    </a>
    <img src="https://img.shields.io/badge/Plataforma-Windows%2010%20%7C%2011-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows" />
    <img src="https://img.shields.io/badge/Linguagem-C%2B%2B17-00599C?style=flat-square&logo=c%2B%2B&logoColor=white" alt="C++17" />
    <img src="https://img.shields.io/badge/Render-Direct3D%2011-10B981?style=flat-square" alt="Direct3D 11" />
  </p>

  <br />

  <!-- Botão de Download -->
  <p align="center">
    <a href="https://github.com/mariocesarflore/Roxy-Room/releases/latest/download/Roxy.Room.Setup.exe">
      <img src="https://img.shields.io/badge/Download-Roxy.Room.Setup.exe-6366F1?style=for-the-badge&logo=windows&logoColor=white" height="40" alt="Download Roxy Room" />
    </a>
  </p>

  <br />

</div>

---

## Navegação Rápida

<p align="center">
  <a href="#visão-geral"><b>Visão Geral</b></a> •
  <a href="#recursos-principais"><b>Recursos</b></a> •
  <a href="#player-minimalista-estilo-youtube"><b>Player YouTube</b></a> •
  <a href="#atalhos-de-teclado"><b>Atalhos</b></a> •
  <a href="#sistema-de-atualização-automática"><b>Auto-Update</b></a> •
  <a href="#guia-de-uso"><b>Guia de Uso</b></a> •
  <a href="#licença-e-termos-de-uso"><b>Licença</b></a>
</p>

---

## Visão Geral

O Roxy Room foi desenvolvido com o propósito de eliminar atrasos e compressões pesadas no compartilhamento de tela e áudio entre computadores.

Diferente de soluções convencionais que redirecionam transmissões para servidores centrais de nuvem, o aplicativo estabelece uma rota direta entre os pontos (Peer-to-Peer) combinada com decodificação e renderização aceleradas por hardware na placa de vídeo.

### Comparativo de Arquitetura

| Característica | Softwares Convencionais | Roxy Room |
| :--- | :--- | :--- |
| **Topologia de Rede** | Servidor central intermediário | Conexão direta Peer-to-Peer (WebRTC) |
| **Latência Típica** | 400ms a 1500ms | 0ms a 15ms |
| **Renderização de Vídeo** | Emulação via CPU / Software | GPU nativa (Microsoft Direct3D 11) |
| **Privacidade** | Fluxo de mídia passa por terceiros | Conexão exclusiva entre os participantes |
| **Consumo de Processador** | Elevado | Mínimo (processamento via hardware) |

---

## Recursos Principais

<table>
  <tr>
    <td width="50%" valign="top">
      <h4>Ultra-Baixa Latência</h4>
      <p>Transmissão direta de dados via WebRTC com STUN/ICE inteligente, reduzindo o atraso para escala de milissegundos.</p>
    </td>
    <td width="50%" valign="top">
      <h4>Aceleração Direct3D 11</h4>
      <p>Pipeline de renderização com hardware gráfico dedicado, sustentando taxas estáveis de 60 FPS sem gargalos de CPU.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h4>Player Estilo YouTube</h4>
      <p>Interface discreta nos cantos, slider de volume expansível, indicador ao vivo e auto-ocultação do cursor.</p>
    </td>
    <td width="50%" valign="top">
      <h4>Captura Seletiva de Áudio</h4>
      <p>Captura de som de alta definição via WASAPI Loopback, permitindo incluir o jogo e excluir aplicativos específicos.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h4>Janela Popout Independente</h4>
      <p>Destaque qualquer transmissão da sala em janela flutuante nativa, ideal para configurações com múltiplos monitores.</p>
    </td>
    <td width="50%" valign="top">
      <h4>Atualizações Automáticas</h4>
      <p>Mecanismo integrado que identifica novas versões no GitHub, baixa os arquivos e atualiza o app sem necessidade de reinstalação.</p>
    </td>
  </tr>
</table>

---

## Player Minimalista Estilo YouTube

Desenvolvido para priorizar a área útil de visualização, o player do Roxy Room organiza todos os comandos essenciais nas extremidades da tela:

<table>
  <tr>
    <td width="33%" align="center">
      <h4>Controles de Mídia</h4>
      <p>Alternância instantânea entre reproduzir e pausar com resposta imediata.</p>
    </td>
    <td width="33%" align="center">
      <h4>Volume Deslizante</h4>
      <p>Controle horizontal retrátil que se expande suavemente com o cursor do mouse.</p>
    </td>
    <td width="33%" align="center">
      <h4>Indicador Ao Vivo</h4>
      <p>Sinalizador discreto de transmissão em tempo real com indicador de pulso.</p>
    </td>
  </tr>
  <tr>
    <td width="33%" align="center">
      <h4>Captura em HD</h4>
      <p>Captura de tela instantânea da transmissão mantendo a resolução original.</p>
    </td>
    <td width="33%" align="center">
      <h4>Janela Popout</h4>
      <p>Exibição isolada em janela dedicada para organizar fluxos em outros monitores.</p>
    </td>
    <td width="33%" align="center">
      <h4>Auto-Ocultação</h4>
      <p>Ocultamento automático dos controles e cursor após 2.5 segundos de inatividade.</p>
    </td>
  </tr>
</table>

---

## Atalhos de Teclado

| Tecla | Ação |
| :---: | :--- |
| <kbd>Espaço</kbd> ou <kbd>K</kbd> | Alternar entre Pausar e Retomar |
| <kbd>M</kbd> | Ativar ou Desativar Áudio |
| <kbd>F</kbd> | Entrar ou Sair de Tela Cheia |
| <kbd>↑</kbd> | Aumentar volume em 5% |
| <kbd>↓</kbd> | Diminuir volume em 5% |
| <kbd>Esc</kbd> | Sair da tela cheia ou fechar player |
| <kbd>Alt</kbd> + <kbd>G</kbd> | Iniciar ou Encerrar Transmissão globalmente |

---

## Sistema de Atualização Automática

O Roxy Room utiliza um fluxo contínuo de atualizações sem atrito:

1. **Checagem Silenciosa:** O aplicativo consulta o manifesto de versão no GitHub na inicialização e a cada 45 minutos.
2. **Notificação de Versão:** Caso uma versão mais recente esteja disponível, um aviso com as notas da versão é exibido.
3. **Download e Aplicação:** O usuário confirma com um clique; o pacote de atualização é baixado em segundo plano e aplicado de forma autônoma.

---

## Guia de Uso

### Instalação
1. Baixe o instalador oficial [Roxy.Room.Setup.exe](https://github.com/mariocesarflore/Roxy-Room/releases/latest/download/Roxy.Room.Setup.exe).
2. Execute o instalador para configurar os atalhos no sistema operacional.

### Conexão e Transmissão
1. Abra o aplicativo e copie o código da sala gerado.
2. Compartilhe o código com o participante para que ele se conecte à mesma sala.
3. Clique em **Iniciar Transmissão** (ou pressione <kbd>Alt + G</kbd>) para compartilhar tela ou janela com áudio.

---

## Compilação e Desenvolvimento Local

Para compilar o código-fonte localmente no Windows:

```bash
# Clonar o repositório
git clone https://github.com/mariocesarflore/Roxy-Room.git
cd Roxy-Room

# Compilar o executável (gera bin/RoxyRoom.exe)
tools\build.bat

# Empacotar instalador e pacote de atualização
python tools/package_release.py 1.0.1 "Notas da versão"
```

---

## Licença e Termos de Uso

Este projeto é distribuído sob os termos da [Licença MIT](LICENSE).

<div align="center">

| Permissões | Condições | Limitações |
| :--- | :--- | :--- |
| Uso comercial | Preservação do aviso de copyright e licença | Nenhuma garantia implícita |
| Modificação do código | | Isenção de responsabilidade |
| Distribuição livre | | |
| Uso privado | | |

<br />

<p>
  Desenvolvido por <strong><a href="https://github.com/mariocesarflore">Mário César Flore</a></strong>.
</p>

</div>
