-- Dados 100% fictícios para os testes locais do painel. Rodar só num Postgres local descartável,
-- depois das migrações 001, 002 e 003.
insert into painel_usuarios (email, nome, papel) values
  ('amanda@teste.local',  'Amanda Teste',  'secretaria'),
  ('gestor@teste.local',  'Gestor Teste',  'gestor'),
  ('planee@teste.local',  'Planee Teste',  'planee')
on conflict do nothing;

insert into contatos (id, nome, telefone, documento, tipo_documento) values
  ('00000000-0000-4000-8000-000000000011', 'Rita Ficticia',  '554790000011', null,          null),
  ('00000000-0000-4000-8000-000000000012', null,             '554790000012', null,          null),
  ('00000000-0000-4000-8000-000000000013', 'Jorge Ficticio', '554790000013', '11122233344', 'cpf')
on conflict do nothing;

insert into atendimentos (contato_id, topico_id, etapa, resumo, aberto_por, aberto_em) values
  ('00000000-0000-4000-8000-000000000011', 'valores', 'aguardando', 'Paciente enviou comprovante de Pix de R$ 200,00 referente ao sinal da consulta de 14/10.', 'IA', now() - interval '45 minutes'),
  ('00000000-0000-4000-8000-000000000012', 'agenda',  'aguardando', 'Pede encaixe ainda esta semana; tem dor forte há 3 dias.', 'IA', now() - interval '3 hours'),
  ('00000000-0000-4000-8000-000000000013', 'docs',    'aguardando', 'Filha pede nota fiscal da mãe (CPF 111.222.333-44) para o imposto de renda, consultas de 2025.', 'IA', now() - interval '10 minutes'),
  ('00000000-0000-4000-8000-000000000013', 'exames',  'finalizado', 'Mandou resultado de hemograma.', 'IA', now() - interval '5 hours');
update atendimentos set finalizado_em = now() - interval '1 hour', responsavel = 'Amanda Teste'
 where etapa = 'finalizado' and resumo like 'Mandou%';
