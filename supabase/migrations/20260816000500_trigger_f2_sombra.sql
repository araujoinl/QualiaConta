-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- F2 en sombra (docs/plan-salida-hermes.md §5-F2): el trigger que reemplaza al
-- poke del poller. Cada INSERT en qualia_trabajos dispara qualia-preparador
-- vía pg_net con el bearer de qualia_config. En modo sombra el preparador
-- calcula el dossier y lo deja en su cache + qualia_sombra sin tocar la fila;
-- el poller del server sigue siendo el único dueño del claim. El poke perdido
-- lo recoge qualia-barrido (rescate 1).
--
-- Además: el RNC comprador de Blackbox para verificar el timbre e-CF
-- (clave 'empresa_rnc' que lee el preparador — mismo valor que
-- QUALIA_EMPRESA_RNC en el .env del server).

create or replace function public.qualia_poke_preparador()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  b text;
begin
  select valor->>'bearer' into b
    from public.qualia_config where empresa_id is null and clave = 'cron_bearer';
  if b is null then
    return new; -- sin bearer no hay poke; el barrido reintenta y salud avisa
  end if;
  perform net.http_post(
    url := 'https://uzvnluxxaekmaqnuocvo.supabase.co/functions/v1/qualia-preparador',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || b),
    body := jsonb_build_object('trabajo_id', new.id, 'motivo', 'insert', 'intento', extract(epoch from now())::bigint),
    timeout_milliseconds := 15000
  );
  return new;
end $$;

revoke execute on function public.qualia_poke_preparador() from public, anon, authenticated;

drop trigger if exists qualia_trabajos_poke_preparador on public.qualia_trabajos;
create trigger qualia_trabajos_poke_preparador
  after insert on public.qualia_trabajos
  for each row execute function public.qualia_poke_preparador();

insert into public.qualia_config (empresa_id, clave, valor, actualizado_por)
values ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'empresa_rnc',
        '{"rnc": "131188648"}', 'migracion 20260816000500')
on conflict (empresa_id, clave) do nothing;
