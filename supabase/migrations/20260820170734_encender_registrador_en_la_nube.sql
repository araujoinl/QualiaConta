-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- F4 — EL CUTOVER (plan corto, OK de Carlos 2026-08-20): el registro de
-- VendorBills, VendorCreditNotes y BankCharges pasa a qualia-registrador.
-- Evidencia previa: backtest en seco 33/40 idénticos con las 7 diferencias
-- explicadas (ediciones humanas posteriores), banco de cuadre 63/63 contra
-- cuadre.py, lista blanca probada sin red, cuadre 1:1 corriendo desde hoy.
--
-- Volver atrás = estas dos filas: modo a 'server' y escritura a 'off'. El
-- poller del server retoma solo (su gate lee esta misma vista).

insert into public.qualia_config (empresa_id, clave, valor, actualizado_por)
values (null, 'modo:qualia-registrador', '{"modo": "nube"}',
        'migracion 20260821001000 (cutover F4: la mano que escribe sale del server)')
on conflict (empresa_id, clave) do update
  set valor = excluded.valor,
      actualizado_por = excluded.actualizado_por,
      actualizado_en = now();

-- El kill-switch nace apagado por diseño; se enciende explícito y POR EMPRESA.
insert into public.qualia_config (empresa_id, clave, valor, actualizado_por)
values ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'escritura', '{"modo": "on"}',
        'migracion 20260821001000 (cutover F4, Blackbox)')
on conflict (empresa_id, clave) do update
  set valor = excluded.valor,
      actualizado_por = excluded.actualizado_por,
      actualizado_en = now();
