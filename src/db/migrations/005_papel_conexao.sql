-- 005: no Postgres gerenciado o usuário da conexão não é superusuário; para "set local role app_tenant"
-- ele precisa ser membro do papel. No banco embutido isso não muda nada.
do $$ begin
  if not pg_has_role(current_user, 'app_tenant', 'member') then
    execute format('grant app_tenant to %I', current_user);
  end if;
end $$;
