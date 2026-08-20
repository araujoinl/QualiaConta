-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- F4 cutover (plan corto, OK de Carlos 2026-08-20): el disparo del
-- registrador de la nube. Dos vías, como en el server: el poke inmediato
-- cuando una fila pasa a 'aprobada' (la mesa registraba en segundos) y el
-- barrido cada 10 minutos como red (el heredero del bloque 3 del poller).
-- El registrador decide solo si le toca (modo + kill-switch + tipos portados):
-- disparar de más es barato, escribir de más es imposible desde acá.

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
    timeout_milliseconds := 5000  -- fire-and-forget: el registro tarda más y no se espera acá
  ) into req_id;
  return req_id;
end $$;

revoke execute on function qualia_disparar_registro(uuid) from public, anon, authenticated;

-- El poke inmediato: cuando el humano aprueba, el registro sale en segundos
-- (como con la mesa). AFTER UPDATE y sólo en el flanco a 'aprobada'.
create or replace function qualia_trg_aprobada_registrar()
returns trigger
language plpgsql
security definer set search_path = public, extensions
as $$
begin
  if new.estado = 'aprobada' and old.estado is distinct from 'aprobada' then
    begin
      perform qualia_disparar_registro(new.id);
    exception when others then
      -- El poke jamás puede tumbar la aprobación: el barrido lo rescata.
      raise warning 'qualia_trg_aprobada_registrar: %', sqlerrm;
    end;
  end if;
  return new;
end $$;

drop trigger if exists qualia_aprobada_registrar on qualia_trabajos;
create trigger qualia_aprobada_registrar
  after update of estado on qualia_trabajos
  for each row execute function qualia_trg_aprobada_registrar();

-- La red: el barrido del registrador cada 10 minutos.
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
    timeout_milliseconds := 5000
  ) into req_id;
  return req_id;
end $$;

revoke execute on function qualia_disparar_barrido_registro() from public, anon, authenticated;

select cron.schedule('qualia-registrador-barrido', '*/10 * * * *',
  $$select public.qualia_disparar_barrido_registro()$$);
