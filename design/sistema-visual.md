# Sistema visual

Aprovado como direção em 24/09/2026. O protótipo em `prototipo/Main.dc.html` é a referência de tela.

## Regra central

**Cor só para estado.** A interface é neutra; a ação primária é preta no tema claro e branca no escuro. Assuntos do quadro de atendimento e etapas do funil comercial **não têm cor**: têm ícone e nome. Assim qualquer projeto configura os seus sem quebrar a leitura, e uma cor sempre significa a mesma coisa.

## Estados

| Estado | Onde aparece | Claro | Escuro | Ícone |
|---|---|---|---|---|
| IA atendendo | dono da conversa | `#0f9a7a` | `#1b9676` | brilho |
| Aguardando equipe | dono da conversa, etapa de atendimento | `#d18f00` | `#b98300` | ampulheta |
| Com a equipe / Em atendimento | dono da conversa, etapa de atendimento | `#1f5fbf` | `#2d8ae0` | pessoa |
| IA em modo restrito | dono da conversa | `#d13438` | `#cf3d46` | alerta |
| Pendente interno | etapa de atendimento | `#a35be6` | `#bb5fc9` | pausa |
| Finalizado | etapa de atendimento | `#8a8880` | `#7d7c77` | check |

Validação (verificador de paleta, todos os pares entre si):

- visão normal: ΔE mínimo 18,9 (claro) e 16,4 (escuro);
- daltonismo: 7,3 e 6,2, faixa que **exige** codificação secundária. Por isso toda pílula de estado leva ícone e nome;
- texto das pílulas (`--x-ink` sobre `--x-bg`): contraste ≥ 5,9:1 nos dois temas.

O âmbar sobre fundo claro tem 2,75:1 como ícone; nunca use a cor âmbar para texto sobre branco, use `--ag-ink`.

## Componentes do protótipo

- **Pílula de estado:** 22px de altura, raio total, ícone 12px + nome, fundo `--x-bg`, texto `--x-ink`.
- **Chip neutro** (CPF, "lead no funil", "sem CPF"): `--surface-3` com `--ink-2`; CPF em Geist Mono.
- **Botão primário:** fundo `--ink`, texto `--inv`, raio 10px, 36–40px de altura.
- **Botão secundário:** fundo `--surface`, borda `--line-strong`.
- **Cartão:** `--surface`, borda `--line`, raio 12px, sombra `--shadow-1`; no hover borda `--line-strong` e `--shadow-2`. Sem borda lateral colorida.
- **Segmentado** (abas da inbox e do CRM): trilho `--surface-3`, item ativo `--surface` com `--shadow-1`.
- **Bolhas:** paciente em `--surface` com borda; IA em `--ia-bg`; equipe em `--ink` com texto `--inv`; nota interna em `--ag-bg` com borda tracejada; sistema em pílula de contorno; chamada de ferramenta em mono sobre `--surface-3` (só para o papel `planee`).
- **Gráficos:** conversas da IA em `--ia`; espera pela equipe em `--ag`; custo em `--ink-2`. Rótulo de valor direto em cada barra e `title` com o valor no hover.

## Tipografia

Geist (400, 500, 600, 700) para tudo; Geist Mono para telefone, CPF, horário e identificadores. Títulos de tela 20–22px peso 650, com espaçamento de letra −0,02em. Corpo 13,5–14px. Rótulos de seção em caixa alta, 11px, peso 600, espaçamento 0,06em, cor `--ink-3`.

## Ícones

Traço de 1,8px, 24×24, cantos arredondados. Os caminhos usados estão na função `icones()` do protótipo.
