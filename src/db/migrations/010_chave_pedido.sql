-- 010: reenvio do mesmo formulário de agendamento (toque duplo) é reconhecido por uma chave aleatória
-- gerada para aquele formulário (guardamos só o hash), e não por telefone e horário, que outra pessoa poderia saber.
alter table bookings add column request_key text;
create unique index bookings_request_key on bookings (shop_id, request_key) where request_key is not null;
