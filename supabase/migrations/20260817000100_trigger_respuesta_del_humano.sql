-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- El segundo timbre de la mesa: cuando el humano responde, corrige o aprueba,
-- hay que despertar al contable. En el server eso lo hacía el poller mirando
-- `qualia_eventos` con un watermark; en la nube lo hace este trigger, con el
-- bearer que vive en la base (nunca en un log ni en un .env).
--
-- Solo eventos de PERSONAS: `autor='usuario'`. Los del contable son su propia
-- voz y despertarlo con ellos sería un bucle.
--
-- Falla suave por diseño: si el poke se pierde, el rescate de qualia-barrido
-- vuelve a mirar la fila. pg_net no garantiza entrega y ésa es la red.

create or replace function public.qualia_poke_contable()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  b text;
  m text;
begin
  if new.autor is distinct from 'usuario' then
    return new;
  end if;
  -- Solo si el análisis lo maneja la nube: con el server a cargo, el poller
  -- sigue siendo quien despierta y dos avisos serían dos turnos sobre la
  -- misma fila.
  select coalesce(valor->>'modo', 'server') into m
    from public.qualia_config
   where empresa_id is null and clave = 'modo:qualia-contable';
  if m is distinct from 'nube' then
    return new;
  end if;

  select valor->>'bearer' into b
    from public.qualia_config where empresa_id is null and clave = 'cron_bearer';
  if b is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://uzvnluxxaekmaqnuocvo.supabase.co/functions/v1/qualia-contable',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || b),
    body := jsonb_build_object(
      'trabajo_id', new.trabajo_id,
      'motivo', 'accion_usuario',
      'evento_id', new.id,
      'intento', extract(epoch from now())::bigint
    ),
    timeout_milliseconds := 15000
  );
  return new;
end $$;

revoke execute on function public.qualia_poke_contable() from public, anon, authenticated;

drop trigger if exists qualia_eventos_poke_contable on public.qualia_eventos;
create trigger qualia_eventos_poke_contable
  after insert on public.qualia_eventos
  for each row execute function public.qualia_poke_contable();
