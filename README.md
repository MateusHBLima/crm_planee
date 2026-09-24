# crm_planee — Painel Planee

Painel de gestão conjunta entre a Planee Lab IA e as clínicas que usam o agente de WhatsApp: inbox espelho do WhatsApp, CRM com funil comercial e quadro de atendimento (configurável por projeto), configurações do agente e resultados.

**Estado:** protótipo aprovado, código ainda não iniciado. Próximo passo: fase 0 do [`PLANO.md`](PLANO.md).

## Para quem vai construir (pessoa ou IA)

1. Leia [`CLAUDE.md`](CLAUDE.md): regras que não se quebram e armadilhas do banco.
2. Leia [`docs/decisoes.md`](docs/decisoes.md): o que já está decidido.
3. Abra o protótipo e navegue pelas telas (link abaixo).
4. Execute o [`PLANO.md`](PLANO.md) em ordem.

## Protótipo

- Navegável: <https://claude.ai/artifact/Vv2pi7RCzo3L5QY8wp4REQ> (use o Play).
- Fonte: [`prototipo/Main.dc.html`](prototipo/Main.dc.html). É um componente do editor de design do Claude: a marcação está em `<x-dc>`, os estilos em linha e a lógica na classe `Component` no fim do arquivo (dados de exemplo, estados, regras de mudança de etapa, configuração do CRM). Não roda sozinho no navegador; use como referência de tela e de comportamento.
- Cores prontas: [`design/tokens.css`](design/tokens.css). Regras: [`design/sistema-visual.md`](design/sistema-visual.md).

## Documentos

| Arquivo | Conteúdo |
|---|---|
| [`docs/especificacao.md`](docs/especificacao.md) | Especificação do produto (17/09, com revisões até 24/09) |
| [`docs/relatorio.md`](docs/relatorio.md) | Relatório completo da solução, escrito para outra IA assumir o contexto |
| [`docs/decisoes.md`](docs/decisoes.md) | Decisões fechadas, com data |

Identificadores de infraestrutura (Meta, n8n, credenciais) ficam no projeto do Claude "Dr. Amilton", **não** neste repositório.

## Configuração local

```bash
cp .env.example .env.local   # preencher com as chaves do Supabase de teste
npm install
npm run dev
```
