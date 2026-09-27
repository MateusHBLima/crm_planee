-- 002 — Semente do CRM (modelo Clínica) e dados 100% fictícios para o Supabase de teste.
-- NÃO rodar em banco de cliente real (lá a semente vem da skill cadastrar-cliente-painel).

insert into crm_etapas (id, ordem, nome, tipo, gatilho) values
  ('novo',        1, 'Novo lead',              'aberta',  'Primeira mensagem'),
  ('contato',     2, 'Contato realizado',      'aberta',  'IA respondeu'),
  ('interesse',   3, 'Interesse identificado', 'aberta',  'Pediu preço ou informou o motivo'),
  ('oferecido',   4, 'Agendamento oferecido',  'aberta',  'Horários enviados'),
  ('followup',    5, 'Follow up',              'aberta',  'Follow-up enviado'),
  ('confirmado',  6, 'Agendamento confirmado', 'ganho',   'Agendamento criado no sistema'),
  ('perdido',     7, 'Perdido',                'perdido', 'Follow-up sem resposta')
on conflict (id) do nothing;

insert into crm_topicos (id, ordem, nome, icone, palavras) values
  ('receita', 1, 'Receita',                     'receita', 'receita, renovação'),
  ('docs',    2, 'Notas fiscais e documentos',  'doc',     'nota fiscal, laudo, atestado'),
  ('exames',  3, 'Exames',                      'exame',   'pedido de exame, resultado'),
  ('valores', 4, 'Valores e pagamento',         'valor',   'desconto, Pix, comprovante'),
  ('agenda',  5, 'Agenda e encaixe',            'agenda',  'encaixe, paciente chegou'),
  ('outros',  6, 'Outros',                      'outros',  'o que não se encaixar')
on conflict (id) do nothing;

insert into crm_config (chave, valor) values
  ('modelo',              '"clinica"'),
  ('termo_contato',       '"paciente"'),
  ('etapas_atendimento',  '{"aguardando":"Aguardando equipe","em_atendimento":"Em atendimento","pendente":"Pendente interno","finalizado":"Finalizado"}'),
  ('campos_cartao',       '{"responsavel":true,"vistas":true,"documento":true,"funil":true}')
on conflict (chave) do nothing;

-- Contatos fictícios (telefones 55 47 90000-xxxx não existem)
insert into contatos (id, nome, telefone, documento, tipo_documento) values
  ('00000000-0000-4000-8000-000000000001', 'Marina Teste',  '5547900000001', '00000000001', 'cpf'),
  ('00000000-0000-4000-8000-000000000002', 'Paulo Teste',   '5547900000002', null,          null),
  ('00000000-0000-4000-8000-000000000003', 'Carla Teste',   '5547900000003', '00000000003', 'cpf'),
  ('00000000-0000-4000-8000-000000000004', 'Beatriz Teste', '5547900000004', '00000000004', 'cpf')
on conflict (id) do nothing;

insert into oportunidades (id, contato_id, interesse, etapa_id) values
  ('00000000-0000-4000-9000-000000000001', '00000000-0000-4000-8000-000000000001', 'Retorno presencial', 'confirmado'),
  ('00000000-0000-4000-9000-000000000002', '00000000-0000-4000-8000-000000000002', 'Valor para família', 'interesse')
on conflict (id) do nothing;

insert into atendimentos (id, contato_id, topico_id, etapa, resumo, aberto_por) values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000001', 'receita', 'aguardando',     'Renovar receita, remédio acaba amanhã', 'IA'),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-8000-000000000003', 'docs',    'em_atendimento', 'Laudo para o trabalho',                  'IA'),
  ('00000000-0000-4000-a000-000000000003', '00000000-0000-4000-8000-000000000004', 'exames',  'pendente',       'Pedido de exame antes da consulta',      'IA')
on conflict (id) do nothing;
