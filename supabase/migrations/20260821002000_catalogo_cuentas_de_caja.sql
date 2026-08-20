-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- F4: los mapas número-de-cuenta→código y tarjeta→código salen de los
-- hardcodes de registrar-pago-factura.py al catálogo por empresa. La moneda
-- viaja pegada al código A PROPÓSITO: ADM tiene cuentas separadas por moneda
-- y pagar cruzando monedas no es un pago, es una conversión (decide un humano).

insert into qualia_catalogo_adm (empresa_id, categoria, clave, valor_uuid, nombre) values
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'cuenta_banco', '11121000000801', null, '101.04|DOP'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'cuenta_banco', '11122010014964', null, '101.05|DOP'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'cuenta_banco', '11122010023874', null, '101.06|DOP'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'cuenta_banco', '21122020001404', null, '102.01|USD'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'cuenta_banco', '21122020002181', null, '102.02|USD'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'tarjeta_numero', '407537XXXXXX1877-DOP', null, '203.10'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'tarjeta_numero', '407537XXXXXX2414-DOP', null, '203.11')
on conflict (empresa_id, categoria, clave) do nothing;
