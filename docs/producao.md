# Produção do painel (decisão 27)

O painel roda no Docker Swarm do projeto PLANEE na Hetzner:

| Servidor | Papel |
|---|---|
| `Manager-01` | líder do Swarm, Traefik (HTTPS), Portainer, n8n |
| `worker-01` | painel (rótulo `planee.papel=painel`) |

Os IPs ficam no console da Hetzner e no projeto do Claude, não neste repositório (ele é público).

Firewall `planee-cluster` nos dois: 22, 80, 443 e ICMP abertos; 2377/tcp, 7946/tcp e 4789–7946/udp só entre os dois servidores.

Não usamos Vercel (removida em 30/09). Antes do PR, cada branch passa pelos testes locais (`testes/painel/rodar.sh`).

## Como uma versão chega ao ar

1. Merge na `main`.
2. O GitHub gera a imagem `ghcr.io/mateushblima/crm_planee` com duas etiquetas: `latest` e a versão curta do commit (ex.: `a1b2c3d`). Workflow: `.github/workflows/imagem.yml`.
3. Em até 5 minutos, o serviço `atualizador` (Shepherd, `deploy/stack-atualizador.yml`) vê a imagem nova e troca as réplicas do painel uma por vez (a nova sobe antes de a velha sair). O webhook de serviço do Portainer seria o caminho natural, mas é recurso pago.
4. Conferir: `https://adm.planeelabia.com/api/saude` responde `{"ok":true,"versao":"<commit>"}`.

## Voltar versão

No Portainer, stack `painel` → variável `VERSAO` com a versão curta anterior (lista em GitHub → Packages → crm_planee) → **Update the stack**. Para voltar ao normal, apague `VERSAO` (volta a `latest`).

Se a versão nova não passar na verificação de saúde, o Swarm volta sozinho para a anterior (`failure_action: rollback`).

## Primeira instalação (uma vez)

1. **DNS:** registro `A` de `adm.planeelabia.com` para o IP do `Manager-01` (GoDaddy).
2. **Imagem pública:** depois da primeira execução do workflow, GitHub → Packages → `crm_planee` → Package settings → Change visibility → Public. A imagem não tem nenhuma chave; tudo vem das variáveis da stack.
3. **Banco:** rodar as migrações 001 a 005 no Supabase (004 no banco central; 005 em todo banco de dados de empresa). No teste, os dois são o mesmo.
4. **Stack:** Portainer → Stacks → Add stack → nome `painel` → colar `deploy/stack-painel.yml` → em **Environment variables**, cadastrar `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `PAINEL_CHAVE_CIFRA` (32+ caracteres, gerada uma vez; sem ela, empresa não pode ter banco próprio). `CENTRAL_DATABASE_URL` só quando o banco central for separado → **Deploy the stack**.
5. **Atualização automática:** Portainer → Stacks → Add stack → nome `atualizador` → colar `deploy/stack-atualizador.yml` → **Deploy the stack**. O painel já tem o rótulo `shepherd.enable=true`.
6. **Domínios pelo painel:** no serviço do Traefik (stack do Traefik no Portainer), acrescentar aos argumentos:
   ```
   --providers.http.endpoint=http://painel_painel:3000/api/traefik
   --providers.http.pollInterval=30s
   ```
   O Traefik passa a ler os domínios das empresas no painel; o `adm.planeelabia.com` continua na etiqueta da stack.

## Domínio de empresa (decisão 26)

1. **Subdomínio nosso** (`clinica.planeelabia.com`): nada no DNS, o registro curinga `*` já aponta para o `Manager-01`.
   **Domínio do cliente** (`painel.clinica.com.br`): o cliente cria um registro `CNAME` para `adm.planeelabia.com` (ou `A` para o IP do `Manager-01`).
2. Painel → **Empresas** → a empresa → **Adicionar domínio**.
3. Em até 30 segundos o Traefik lê `/api/traefik`, cria a rota e emite o HTTPS.

Nenhum desses passos é commit nem mexe na stack. Empresa desativada sai do Traefik sozinha.

## Empresas, pessoas e permissões (decisão 26)

- **Master** (Planee): `painel_usuarios.master = true`. Tela **Empresas**: criar empresa, módulos liberados, domínios, admins, banco próprio.
- **Admin**: tela **Equipe** da empresa. Adiciona membros com os modelos Secretária/Gestor ou permissão a permissão, sempre dentro dos módulos da empresa.
- **Primeiro acesso**: o e-mail cadastrado cria a senha em `/entrar/primeiro-acesso`. Deixar ligado "Confirm email" no Supabase Auth, para ninguém criar a senha de um e-mail que não é dele.

## Rede e Traefik

O Traefik do manager é a versão 3, com o provedor `swarm`: rede `network_public`, entrypoint `websecure` (o `web` redireciona para ele) e resolvedor de certificado `letsencryptresolver` (desafio HTTP). A stack usa esses nomes, conferidos em 30/09. As rotas de domínio de empresa usam o serviço `painel@swarm`; se algum nome mudar, as variáveis `TRAEFIK_SERVICO`, `TRAEFIK_ENTRYPOINT` e `TRAEFIK_CERTRESOLVER` da stack ajustam `/api/traefik`.
