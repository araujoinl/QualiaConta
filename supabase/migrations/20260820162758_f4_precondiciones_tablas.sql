-- F4 precondiciones 7, 8 y 12 (plan-f4-registrador.md §11.4).
-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.

-- ────────────────────────────────────────────────────────────────────────────
-- Precondición 7 — la lista de tipos registrables vive en UN solo lugar.
-- Hoy vive en tres (script_de_registro de poller.sh, ENDPOINTS de
-- qualia-lapidas, y un comentario desactualizado) y ya se desincronizó tres
-- veces. Desde acá: poller, lápidas, cuadre y registrador leen ESTA tabla.
-- El case de poller.sh:305-340 y el ENDPOINTS de lapidas coinciden hoy en los
-- mismos 7 tipos (verificado 2026-08-20) — el comentario de poller.sh:289 que
-- decía «BankBankTransfers queda AFUERA» era el desactualizado.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists qualia_tipos_registrables (
  documento_adm text primary key,
  prefijo text not null,
  script_registro text not null, -- herencia del server; muere con la mesa
  registrable boolean not null default true,
  verificable boolean not null default true, -- qualia-lapidas lo barre
  orden_encendido_f4 int, -- plan-f4 §1: menor = se enciende antes; null = nunca autónomo
  notas text
);

comment on table qualia_tipos_registrables is
  'Única fuente de los tipos de documento que la mesa registra y verifica (F4 prec. 7). '
  'poller.sh, qualia-lapidas y el registrador leen de acá; definir la lista en otro lado es el bug.';

insert into qualia_tipos_registrables
  (documento_adm, prefijo, script_registro, registrable, verificable, orden_encendido_f4, notas)
values
  ('BankCharges',       'CB',  'registrar-cargo-bancario.py',        true, true, 1,
   'primero: mejor prueba de propiedad (NCF/banco_tx_id), falla AMBIGUO, 1 POST, espejo en openbanking'),
  ('Journals',          'ED',  'registrar-asiento-diario.py',        true, true, 2,
   'no-nómina. La nómina (3 POST encadenados) NUNCA es autónoma: plan-f4 §6'),
  ('VendorBills',       'FP',  'registrar-en-adm.py',                true, true, 3,
   'el volumen y el 606; NCF y referencia como doble freno de duplicados'),
  ('VendorCreditNotes', 'NCP', 'registrar-en-adm.py',                true, true, 3,
   'mismo script que VendorBills; la decide el NCF E34, no documento_adm'),
  ('BankBankTransfers', 'TE',  'registrar-transferencia-bancaria.py', true, true, 4,
   'barrera AMBIGUO ya portada; el comentario viejo del poller decía AFUERA y el case decía adentro — ganó el case'),
  ('AccountPayments',   'PC',  'registrar-pago-cuenta.py',           true, true, 5,
   'POST + Authorize: el asiento nace al Authorize (PC00000376: sin Items nace en 0 y vacío)'),
  ('BillPayments',      'PP',  'registrar-pago-factura.py',          true, true, 6,
   'mueve plata; saldos SOLO de /api/AP; de más nunca, de menos sólo declarado')
on conflict (documento_adm) do nothing;

alter table qualia_tipos_registrables enable row level security;
-- Sin policies: sólo service_role (las functions) la lee. La web no la necesita.

-- ────────────────────────────────────────────────────────────────────────────
-- Precondición 8 — catálogo de GUIDs de ADM por empresa, en tabla.
-- Hoy son constantes hardcodeadas en 6 archivos y atan todo a Blackbox
-- (brecha 1 del plan madre). Los UUID sembrados son los verificados contra el
-- ADM vivo: TAX_* y TERMINOS de registrar-en-adm.py, UUIDS_CONOCIDOS de
-- registrar-cargo-bancario.py, y /api/ExpenseTypes leído el 2026-08-20.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists qualia_catalogo_adm (
  empresa_id uuid not null references admcloud_empresas(id),
  categoria text not null,
  clave text not null,
  valor_uuid uuid,
  nombre text,
  primary key (empresa_id, categoria, clave)
);

comment on table qualia_catalogo_adm is
  'GUIDs de los catálogos de ADM por empresa (F4 prec. 8): tax schedules, tipos de gasto 606, '
  'términos de pago, cuentas fuera del paginado, cuentas de caja/tarjeta. Un hardcode en el '
  'registrador es la brecha que esta tabla mata.';

insert into qualia_catalogo_adm (empresa_id, categoria, clave, valor_uuid, nombre) values
  -- Tax schedules (ITBIS por tasa efectiva)
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'tax_schedule', '18', 'f980499b-4f32-48cb-8c6f-5fe74d245528', 'ITBIS 18%'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'tax_schedule', '16', '26b690b9-cc2a-4ced-d30b-08dd66faeff4', 'ITBIS 16% (reducida art. 343)'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'tax_schedule', '30', '264c13b2-286d-4b60-03b8-08dd34a31da8', 'ITBIS 30% (telecomunicaciones)'),
  -- Tipos de gasto del 606 (/api/ExpenseTypes, 2026-08-20)
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'expense_type', '01', '5a3e2b65-1ad3-42b3-bdf8-adaa3482b412', 'Gastos de Personal'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'expense_type', '02', 'dcda501b-23df-4074-a8b8-039a153c6b44', 'Gastos por Trabajos, Suministros y Servicios'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'expense_type', '03', '341c9bda-4499-4319-aeb6-bd5729210a63', 'Arrendamientos'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'expense_type', '04', '03cbbf28-1313-456b-b00d-5e6f07abbbf2', 'Gastos de Activo Fijo'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'expense_type', '05', '7a079ece-0739-48e0-b4ae-5ef94b048df0', 'Gastos de Representación'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'expense_type', '06', '9c9f8e57-cf48-4c01-b0d6-701044fd693d', 'Otras Deducciones Admitidas'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'expense_type', '07', 'aaee37e1-3cde-485d-92fd-a0db22efd789', 'Gastos Financieros'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'expense_type', '08', '90f3a205-75cd-4a8c-b276-fc1d93a715d9', 'Gastos Extraordinarios'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'expense_type', '09', '672f92d8-3f1b-47fc-932f-144df33f455c', 'Compras y Gastos que Formarán parte del Costo de Venta'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'expense_type', '10', '6b2893d2-309a-4566-8007-6edf05660933', 'Adquisición de Activos'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'expense_type', '11', '28c0d46f-a2ab-4089-afc0-ce4c4e7d3b7f', 'Gastos de Seguros'),
  -- Términos de pago (PaymentTermID; obligatorio en VendorBills aunque el schema diga opcional)
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'termino_pago', 'al contado', '94940a99-f119-4573-8bbd-08dd14abff09', 'Al contado'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'termino_pago', '30', 'b002e9c1-0430-4809-8612-b27db42a35a0', '30 días'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'termino_pago', '45', '27e7f4f5-f179-40f0-6fb0-08dd14abefee', '45 días'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'termino_pago', '60', 'a101c88e-5a4c-4860-17e0-08dd149772e6', '60 días'),
  -- Cuentas que /api/Accounts no pagina pero existen por UUID directo
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'cuenta_uuid', '700.01', '576cbb2b-ab48-4b26-77fc-08dd1014e167', 'Intereses Bancarios'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'cuenta_uuid', '150.06', '4cef27bb-50aa-4e94-1c6b-08dd4c3ef461', 'Retención DGII 1% Norma 07-19'),
  -- Tarjetas que son caja aunque su código viva en el pasivo (enumeradas, jamás por prefijo 203.)
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'cuenta_caja_tarjeta', '203.10', null, 'Tarjeta corporativa (caja en ADM)'),
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'cuenta_caja_tarjeta', '203.11', null, 'Tarjeta corporativa (caja en ADM)'),
  -- Config puntual
  ('1de77ce6-ed98-4a96-8b1f-d8b902f11cd5', 'config', 'tipo_gasto_defecto', 'dcda501b-23df-4074-a8b8-039a153c6b44', '02 cuando la propuesta no trae tipo')
on conflict (empresa_id, categoria, clave) do nothing;

alter table qualia_catalogo_adm enable row level security;
-- Sin policies: sólo service_role (las functions) la lee.

-- ────────────────────────────────────────────────────────────────────────────
-- Precondición 12 — CHECK de evidencia EXTENDIDO (enmienda E6). El CHECK del
-- 2026-08-03 (qualia_conta_registrada_con_evidencia) sólo exigía docid no
-- nulo; la forma final exige docid NO VACÍO y la autorización NO pendiente —
-- un pago creado sin Authorize no es "registrada", es "parcial". Verificado
-- antes de aplicar: 0 filas violan sobre 389 (2026-08-20).
-- ────────────────────────────────────────────────────────────────────────────
alter table qualia_trabajos
  drop constraint if exists qualia_trabajos_registrada_con_evidencia;
alter table qualia_trabajos
  add constraint qualia_trabajos_registrada_con_evidencia check (
    estado <> 'registrada'
    or (
      coalesce(propuesta->'registro_adm'->>'docid', '') <> ''
      and coalesce((propuesta->'registro_adm'->>'pendiente_autorizacion')::boolean, false) = false
    )
  );
