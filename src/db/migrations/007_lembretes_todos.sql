-- 007: lembretes (com confirmação e remarcação pelo cliente) valem em todos os planos: é o que mais segura cliente
-- de faltar, e o sistema já não restringe a tela por plano. A lista de recursos do plano passa a dizer a verdade.
update plans set features = features || '["lembretes"]'::jsonb where not features @> '["lembretes"]'::jsonb;
