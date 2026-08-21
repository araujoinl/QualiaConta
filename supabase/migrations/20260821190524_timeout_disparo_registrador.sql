-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- La segunda mitad del «enganchado» del 2026-08-21: el disparo del
-- registrador (poke y barrido) usaba timeout_milliseconds := 5000 como
-- fire-and-forget. Pero cortar la conexión a los 5s NO es inocuo en Edge
-- Functions: al desconectarse el cliente el runtime puede matar el isolate a
-- mitad del trabajo — sin evento, sin error_detalle, sin ledger. Un registro
-- de factura tarda 2-3s y sobrevivía; el BillPayments (saldos de AP, tipos de
-- pago, relectura de facturas, POST + Authorize) tarda más de 5s y moría
-- SIEMPRE, dejando su claim puesto hasta el TTL.
--
-- La cura: darle a la conexión el mismo aire que el TTL del claim (150s).
-- net.http_post es asíncrono igual — el trigger y el cron no esperan: la
-- espera vive en el worker de pg_net, que para eso está.

create or replace function qualia_disparar_registro(p_trabajo uuid)
returns bigint
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  b text;
  req_id bigint;
begin
  select valor->>'bearer' into b
    from public.qualia_config where empresa_id is null and clave = 'cron_bearer';
  if b is null then
    raise exception 'qualia_disparar_registro: falta cron_bearer en qualia_config';
  end if;
  select net.http_post(
    url := 'https://uzvnluxxaekmaqnuocvo.supabase.co/functions/v1/qualia-registrador',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || b),
    body := jsonb_build_object('accion', 'registrar', 'trabajo_id', p_trabajo::text),
    timeout_milliseconds := 150000  -- ver cabecera: 5000 mataba el isolate a mitad del pago
  ) into req_id;
  return req_id;
end $$;

create or replace function qualia_disparar_barrido_registro()
returns bigint
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  b text;
  req_id bigint;
begin
  select valor->>'bearer' into b
    from public.qualia_config where empresa_id is null and clave = 'cron_bearer';
  if b is null then
    raise exception 'falta cron_bearer';
  end if;
  select net.http_post(
    url := 'https://uzvnluxxaekmaqnuocvo.supabase.co/functions/v1/qualia-registrador',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || b),
    body := jsonb_build_object('accion', 'barrido'),
    timeout_milliseconds := 150000
  ) into req_id;
  return req_id;
end $$;
