-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- Las lápidas pasan a la nube. Corrían por `docker exec` dentro del gateway
-- Hermes (cron `35 * * * *`), así que al apagarlo quedaron muertas — y son la
-- ÚNICA forma de enterarse de que un documento registrado desapareció de ADM
-- (revertir allá BORRA sin dejar rastro).
--
-- La function ya está desplegada con su cron propio y su port trae las cuatro
-- guardas medidas: consulta por UUID uno por uno, distingue anulado de
-- eliminado, verifica que el ID devuelto sea el pedido, y lo inverificable NO
-- se marca (la versión por listado enterró 61 cargos vivos el 2026-08-04).
--
-- Volver atrás: esta fila a {"modo": "server"} — pero ojo, el cron del server
-- entra al contenedor apagado: sin Hermes, la nube es el único lugar donde
-- esto puede correr.

insert into public.qualia_config (empresa_id, clave, valor, actualizado_por)
values (null, 'modo:qualia-lapidas', '{"modo": "nube"}',
        'migracion 20260817000300 (la red de documentos borrados sale de Hermes)')
on conflict (empresa_id, clave) do update
  set valor = excluded.valor,
      actualizado_por = excluded.actualizado_por,
      actualizado_en = now();
