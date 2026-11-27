-- 002: nome informado em cada reserva.
-- Antes, a confirmação pública mostrava o nome do cadastro do cliente encontrado pelo telefone,
-- o que permitia descobrir o nome de quem tem um número só digitando o telefone. Agora a página
-- pública usa apenas o nome digitado naquela reserva.
alter table bookings add column contact_name text check (contact_name is null or length(contact_name) between 2 and 80);
update bookings b set contact_name = c.name from customers c where c.id = b.customer_id and b.contact_name is null;
