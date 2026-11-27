-- 008: aviso por e-mail ao dono (e gerentes) quando um cliente marca, remarca ou cancela pela página. Ligado por padrão.
alter table shops add column notify_email boolean not null default true;
grant update (notify_email) on shops to app_tenant;
