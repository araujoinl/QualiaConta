-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- F4: el RNC del banco emisor de comprobantes entra al catálogo por empresa
-- (categoría banco_rnc; el RNC viaja en `nombre` porque no es un uuid). Es el
-- mapa BANCO_RNC del script, ahora por tabla — Santa Cruz verificado contra
-- Vendors de ADM el 2026-08-19 (caso RNC de los cargos bancarios).

insert into qualia_catalogo_adm (empresa_id, categoria, clave, valor_uuid, nombre) values
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'banco_rnc', 'santacruz', null, '102012921')
on conflict (empresa_id, categoria, clave) do nothing;
