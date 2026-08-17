-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- El cutover del ANÁLISIS: preparador, proponedor y turno pasan a nube.
-- Con esto el poller del server cede el claim (lee qualia_modos y se abstiene)
-- y el gateway Hermes deja de tener trabajo: sus 5 crons ya están pausados y
-- sus turnos difíciles los atiende qualia-contable.
--
-- Lo que NO cambia: el contenedor de la mesa sigue registrando en ADM lo que
-- vos aprobás y corriendo sus barridos. Eso es F4.
--
-- Volver atrás: estas tres filas a {"modo": "server"}; el poller retoma en su
-- siguiente tick (20s).

insert into public.qualia_config (empresa_id, clave, valor, actualizado_por)
values
  (null, 'modo:qualia-preparador', '{"modo": "nube"}', 'migracion 20260817000200 (apagon de Hermes)'),
  (null, 'modo:qualia-proponedor', '{"modo": "nube"}', 'migracion 20260817000200 (apagon de Hermes)'),
  (null, 'modo:qualia-contable',   '{"modo": "nube"}', 'migracion 20260817000200 (apagon de Hermes)')
on conflict (empresa_id, clave) do update
  set valor = excluded.valor,
      actualizado_por = excluded.actualizado_por,
      actualizado_en = now();
