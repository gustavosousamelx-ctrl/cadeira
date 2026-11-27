-- 014: no Postgres 16 o usuário que cria o papel vira membro só com ADMIN, sem SET.
-- O 005 via pg_has_role e pulava o GRANT (já era membro), então "set local role app_tenant"
-- falhava com "permission denied to set role".
do $$ begin
  execute format('grant app_tenant to %I with set true', current_user);
end $$;
