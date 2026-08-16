-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- El poller del server necesita saber si el análisis diario ya lo maneja la
-- nube, para ABSTENERSE de reclamar: el claim tiene que tener un solo dueño o
-- se reclaman entre ellos y el trabajo queda colgado en 'analizando' hasta que
-- un barrido lo suelte.
--
-- Se expone por una VISTA y no dando acceso a qualia_config, que además del
-- modo guarda el bearer de los crons: la vista deja pasar SOLO las claves de
-- modo. security_invoker para que la vista no eleve privilegios (Postgres 17).

create view public.qualia_modos
with (security_invoker = true) as
  select empresa_id, clave, valor
    from public.qualia_config
   where clave = 'modo' or clave like 'modo:%';

comment on view public.qualia_modos is
  'Solo las claves de modo de qualia_config, para que el poller del server sepa cuándo abstenerse. Sin secretos: el bearer NO pasa por acá.';

-- El rol del poller (mismo DSN de siempre) solo necesita leer.
grant select on public.qualia_config to qualiaconta_lector;
grant select on public.qualia_modos to qualiaconta_lector;
