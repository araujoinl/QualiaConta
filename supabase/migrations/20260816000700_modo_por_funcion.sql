-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- Interruptor POR FUNCIÓN (clave `modo:<funcion>`, con respaldo al `modo`
-- global) y primer encendido real de la mudanza: los DETECTORES pasan a nube.
--
-- Por qué los detectores primero: sus 5 crons (`sugerir-*`) viven DENTRO del
-- gateway Hermes y mueren con él. La sombra ya midió la equivalencia — 0
-- sugerencias nuevas con 0 errores, o sea que las 5 llaves de reclamo
-- reconocen todo lo que el server sembró.
--
-- Lo que NO se enciende todavía (siguen en sombra por el respaldo global):
-- preparador, proponedor y lápidas. El poller del server sigue siendo el dueño
-- del claim diario y del registro en ADM; apagar eso es F4, no hoy.
--
-- Volver atrás es un UPDATE de esta fila a {"modo": "server"}.

insert into public.qualia_config (empresa_id, clave, valor, actualizado_por)
values (null, 'modo:qualia-sugerencias', '{"modo": "nube"}',
        'migracion 20260816000700 (los 5 sugerir-* salen de Hermes)')
on conflict (empresa_id, clave) do update
  set valor = excluded.valor,
      actualizado_por = excluded.actualizado_por,
      actualizado_en = now();
