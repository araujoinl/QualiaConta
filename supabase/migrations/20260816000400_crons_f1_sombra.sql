-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- F1 en sombra (docs/plan-salida-hermes.md §5-F1): el disparador central de
-- las functions de qualia y sus tres crons. El bearer viaja desde
-- qualia_config (nunca en el DDL ni en un log). Las functions arrancan en modo
-- 'sombra': calculan todo y escriben SOLO qualia_sombra — los crons de Hermes
-- y del server siguen siendo los únicos que tocan producción hasta comparar
-- los 7 días que pide el criterio de F1.

create or replace function public.qualia_disparar(slug text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  b text;
  req_id bigint;
begin
  select valor->>'bearer' into b
    from public.qualia_config where empresa_id is null and clave = 'cron_bearer';
  if b is null then
    raise exception 'qualia_disparar: falta cron_bearer en qualia_config';
  end if;
  select net.http_post(
    url := 'https://uzvnluxxaekmaqnuocvo.supabase.co/functions/v1/' || slug,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || b),
    body := jsonb_build_object('origen', 'pg_cron', 'ts', now()::text),
    timeout_milliseconds := 30000
  ) into req_id;
  return req_id;
end $$;

comment on function public.qualia_disparar(text) is
  'Dispara una function de qualia con el bearer de qualia_config. SECURITY DEFINER para leer el bearer; ejecutable solo por los crons.';

revoke execute on function public.qualia_disparar(text) from public, anon, authenticated;

-- Cadencias: barrido cada 2 min (heredero de los rescates del poller),
-- sugerencias 2 veces por hora (los 5 sugerir-* de Hermes corrían escalonados
-- 0-50; acá corren en secuencia dentro de una invocación), salud diaria 12:00
-- UTC = 8:00 AM RD (misma hora que alerta-salud.sh).
select cron.schedule('qualia-barrido', '*/2 * * * *', $$select public.qualia_disparar('qualia-barrido')$$);
select cron.schedule('qualia-sugerencias', '4,34 * * * *', $$select public.qualia_disparar('qualia-sugerencias')$$);
select cron.schedule('qualia-salud', '0 12 * * *', $$select public.qualia_disparar('qualia-salud')$$);

-- Modo global: SOMBRA. El default del código sigue siendo 'server'; esta fila
-- es el interruptor auditable del cutover (volver atrás = volver a 'server').
update public.qualia_config
   set valor = '{"modo": "sombra"}',
       actualizado_por = 'migracion 20260816000400 (encendido de la sombra F1)',
       actualizado_en = now()
 where empresa_id is null and clave = 'modo';
