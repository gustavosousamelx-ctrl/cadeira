-- Repara cadastros antigos feitos enquanto o plano padrão estava indisponível.
-- A duração do teste conta da criação da barbearia. Nenhuma cobrança é criada.
insert into saas_subscriptions (shop_id, plan_id, status, trial_ends_at)
select sh.id, p.id,
  case when sh.created_at + make_interval(days => p.trial_days) > now() then 'trialing' else 'expired' end,
  sh.created_at + make_interval(days => p.trial_days)
from shops sh
cross join lateral (
  select id, trial_days from plans
  order by active desc, (id = case when sh.is_demo then 'gestao' else 'profissional' end) desc, sort, id
  limit 1
) p
where not exists (select 1 from saas_subscriptions s where s.shop_id = sh.id);
