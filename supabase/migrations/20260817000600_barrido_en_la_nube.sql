-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- El barrido pasa a nube. Era el último de la cadena del análisis que seguía
-- en 'sombra' mientras preparador, proponedor y contable ya escribían de
-- verdad (migración 20260817000200): la red quedó simulando debajo de un
-- trapecio real.
--
-- El agujero, medido hoy con IMG_3606 (trabajo 3f771b25): en una ráfaga de 5
-- fotos el preparador avisó `vision: concurrencia 5 llamadas en vuelo (tope
-- 4)` y el turno murió al segundo — `llm_fallo en 1 iteración(es), 1s, 0
-- tokens de entrada`, sin dejar error_detalle. La mesa soltó la reserva a los
-- 20 min y la fila volvió a 'pendiente'; desde ahí el único que la rescata es
-- el rescate 1 de este barrido, que cada 2 minutos anotó en qualia_sombra el
-- poke que habría hecho. 35 minutos "En cola" en la bandeja, sin dueño.
--
-- Qué se enciende con esto:
--   1) 're_poke'        -> pokes reales al preparador (el agujero de arriba).
--   2) 'reserva_muerta' -> libera reservas > 20 min; la mesa hace lo mismo,
--                          el update va condicionado por estado y no se pisan.
--   3) 'registro_reintento' -> despierta al turno cuando el registrador se
--                          NEGÓ (aprobada sin docid). Escalonado y anclado en
--                          la marca sistema/aviso_registro, así que no repite
--                          cada 2 min. Alcanza a a9addaf8 (Guan Lan), aprobada
--                          sin registrar desde hace ~10 h.
--   4) 'sin_libro'      -> sigue siendo solo detección: sus remedios son F4.
--
-- Volver atrás: esta fila a {"modo": "sombra"} y el barrido vuelve a anotar
-- sin tocar nada, en el siguiente tick del cron (2 min).

insert into public.qualia_config (empresa_id, clave, valor, actualizado_por)
values (null, 'modo:qualia-barrido', '{"modo": "nube"}',
        'migracion 20260817000600 (la red del análisis deja de ser simulacro)')
on conflict (empresa_id, clave) do update
  set valor = excluded.valor,
      actualizado_por = excluded.actualizado_por,
      actualizado_en = now();
