-- Uma venda avulsa por formulário, incluindo reenvios após perda da resposta.
alter table sales add column request_key uuid;
create unique index sales_request_key on sales (shop_id, created_by, request_key);
