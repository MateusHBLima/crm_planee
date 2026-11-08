-- Migração 033 (banco CENTRAL, 06/11): cliente novo sem Portainer.
--   - empresa_integracoes.token_cifrado: o token de cada integração (ex.: Feegow) colado na tela Empresas, cifrado
--     com PAINEL_CHAVE_CIFRA como o do WhatsApp. Substitui FEEGOW_TOKENS da stack (que continua valendo como reserva).
--   - teste_em / teste_erro: resultado do teste feito ao salvar.
--   - empresas.n8n_segredo_cifrado: segredo próprio da empresa no cabeçalho x-painel-segredo (avisos, Dúvidas).
--     Sem ele, vale N8N_WEBHOOK_SEGREDO da stack, como hoje.
--   - whatsapp_numeros.cadastro_codigo_cifrado: código do cadastro incorporado da Meta (coexistência), que o
--     receptor troca pelo token do número e apaga.
-- Só acrescenta colunas; rodar de novo não muda nada.
alter table if exists empresa_integracoes add column if not exists token_cifrado text;
alter table if exists empresa_integracoes add column if not exists teste_em timestamptz;
alter table if exists empresa_integracoes add column if not exists teste_erro text;
alter table empresas add column if not exists n8n_segredo_cifrado text;
alter table whatsapp_numeros add column if not exists cadastro_codigo_cifrado text;
