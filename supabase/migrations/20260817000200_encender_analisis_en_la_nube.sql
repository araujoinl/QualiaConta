-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- EL CUTOVER DEL ANÁLISIS. Preparador, proponedor y turno pasan a nube: desde
-- acá el claim de cada trabajo lo toma la nube y el poller del server se
-- abstiene (lee `modo:qualia-preparador` por la vista qualia_modos).
--
-- Con qué evidencia se enciende:
--   - El backtest sobre facturas YA resueltas dio los mismos NCF, montos y
--     documentos que el server, en PDF, foto y HEIC (§5.bis del plan).
--   - El examen del corpus dorado: el camino diario aprueba, y el caso que
--     fallaba peligrosamente (nuevo-milenio) hoy propone EXACTO lo registrado,
--     re-verificando en DGII el comprobante que el humano corrigió (§5.ter).
--   - La compuerta de suficiencia frena lo que el registrador exige y el turno
--     no traía: un cargo sin dirección (que entraba como plata que ENTRÓ), un
--     pago sin cuenta de origen, un estado de DGII que contradice al dossier.
--
-- Lo que NO cambia: aprobar sigue siendo del humano, y registrar en ADM lo
-- sigue haciendo el poller del server (eso es F4).
--
-- Volver atrás: UPDATE de estas tres filas a {"modo": "server"}. El poller
-- vuelve a reclamar en el tick siguiente (20s) sin redeploy.

insert into public.qualia_config (empresa_id, clave, valor, actualizado_por)
values
  (null, 'modo:qualia-preparador', '{"modo": "nube"}', 'migracion 20260817000200 (cutover del analisis)'),
  (null, 'modo:qualia-proponedor', '{"modo": "nube"}', 'migracion 20260817000200 (cutover del analisis)'),
  (null, 'modo:qualia-contable',   '{"modo": "nube"}', 'migracion 20260817000200 (cutover del analisis)')
on conflict (empresa_id, clave) do update
  set valor = excluded.valor,
      actualizado_por = excluded.actualizado_por,
      actualizado_en = now();
