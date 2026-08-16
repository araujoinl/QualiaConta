-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- Corrige la migración anterior (20260816000800): con `security_invoker = true`
-- la vista corre con los privilegios de quien la lee, así que el rol del poller
-- necesitaba SELECT sobre `qualia_config` — la tabla donde vive el bearer de
-- los crons. Exactamente lo que esa migración decía evitar.
--
-- La forma correcta para exponer un SUBCONJUNTO sin entregar la tabla es una
-- vista con semántica de definidor: corre con los privilegios de su dueño,
-- filtra a las claves de modo, y al rol se le da acceso SOLO a la vista.

revoke select on public.qualia_config from qualiaconta_lector;

create or replace view public.qualia_modos
with (security_invoker = false) as
  select empresa_id, clave, valor
    from public.qualia_config
   where clave = 'modo' or clave like 'modo:%';

comment on view public.qualia_modos is
  'Solo las claves de modo de qualia_config, para que el poller del server sepa cuándo abstenerse. Vista de definidor: el lector NO tiene acceso a la tabla, así que el bearer de los crons no se expone.';

grant select on public.qualia_modos to qualiaconta_lector;
