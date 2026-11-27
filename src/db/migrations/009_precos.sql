-- 009: preços de lançamento (sem taxa por agendamento). Só preenche planos ainda sem preço:
-- valores já definidos pelo admin em /admin/planos não são tocados.
-- Referência (nov/2026): BarberOS cobra R$ 47,90 / 97,90 / 197,90 por mês mais R$ 4 / 3 / 2 por agendamento.
update plans set price_cents = 4990  where id = 'essencial'    and price_cents = 0;
update plans set price_cents = 8990  where id = 'profissional' and price_cents = 0;
update plans set price_cents = 14990 where id = 'gestao'       and price_cents = 0;
