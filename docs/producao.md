# Produção do painel (decisão 27)

O painel roda no Docker Swarm do projeto PLANEE na Hetzner:

| Servidor | IP | Papel |
|---|---|---|
| `Manager-01` | 188.34.152.235 | líder do Swarm, Traefik (HTTPS), Portainer, n8n |
| `worker-01` | 188.245.3.108 | painel (rótulo `planee.papel=painel`) |

Firewall `planee-cluster` nos dois: 22, 80, 443 e ICMP abertos; 2377/tcp, 7946/tcp e 4789–7946/udp só entre os dois servidores.

A Vercel (plano grátis) fica só como link de teste das branches, ligado ao Supabase de teste.

## Como uma versão chega ao ar

1. Merge na `main`.
2. O GitHub gera a imagem `ghcr.io/mateushblima/crm_planee` com duas etiquetas: `latest` e a versão curta do commit (ex.: `a1b2c3d`). Workflow: `.github/workflows/imagem.yml`.
3. Se o segredo `PORTAINER_WEBHOOK_PAINEL` estiver cadastrado no GitHub, o Portainer é avisado e troca as réplicas uma por vez (a nova sobe antes de a velha sair). Sem o segredo, a atualização é feita no Portainer: stack `painel` → **Update the stack** com **Re-pull image**.
4. Conferir: `https://adm.planeelabia.com/api/saude` responde `{"ok":true,"versao":"<commit>"}`.

## Voltar versão

No Portainer, stack `painel` → variável `VERSAO` com a versão curta anterior (lista em GitHub → Packages → crm_planee) → **Update the stack**. Para voltar ao normal, apague `VERSAO` (volta a `latest`).

Se a versão nova não passar na verificação de saúde, o Swarm volta sozinho para a anterior (`failure_action: rollback`).

## Primeira instalação (uma vez)

1. **DNS:** registro `A` de `adm.planeelabia.com` para `188.34.152.235` (GoDaddy).
2. **Imagem pública:** depois da primeira execução do workflow, GitHub → Packages → `crm_planee` → Package settings → Change visibility → Public. A imagem não tem nenhuma chave; tudo vem das variáveis da stack.
3. **Stack:** Portainer → Stacks → Add stack → nome `painel` → colar `deploy/stack-painel.yml` → em **Environment variables**, cadastrar `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (e `PAINEL_MODO`, se não for `adm`) → **Deploy the stack**.
4. **Atualização automática:** Portainer → Services → `painel_painel` → **Service webhook** ligado → copiar o endereço → GitHub → Settings → Secrets and variables → Actions → New secret `PORTAINER_WEBHOOK_PAINEL`.

## Domínio de empresa (decisão 26)

1. A empresa cria o registro `A` (ou `CNAME` para `adm.planeelabia.com`) do domínio dela apontando para `188.34.152.235`.
2. Portainer → stack `painel` → na regra do roteador, acrescentar ``|| Host(`novo.dominio`)`` → **Update the stack**. O Traefik emite o certificado sozinho.
3. Cadastrar o domínio na empresa, na tela do master.

Nenhum desses passos é commit.

## Rede e Traefik

A stack usa a rede `network_public`, o entrypoint `websecure` e o resolvedor de certificado `letsencryptresolver`, os mesmos do n8n e do Portainer. Se o Traefik do manager usar outros nomes, ajuste as etiquetas `traefik.*` da stack.
