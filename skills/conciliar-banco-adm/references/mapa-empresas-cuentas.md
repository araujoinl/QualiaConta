# Mapa de cuentas por empresa

Las cuentas bancarias en `openbanking_accounts` pertenecen a distintas
empresas. Antes de cualquier análisis, filtrar por las cuentas correctas.

## Blackbox SRL (Banco Santa Cruz)

`credential_ref = 'santacruz-Blackbox'`

| Cuenta | Nombre | Moneda |
|---|---|---|
| 11121000000801 | Ingresos | DOP |
| 11122010014964 | Impuestos | DOP |
| 11122010023874 | Operaciones | DOP |
| 21122020001404 | Suplidores | USD |
| 21122020002181 | Ganancias | USD |

## Impact Logistics (otra empresa — NO incluir en análisis de Blackbox)

| Cuenta | Nombre | Banco |
|---|---|---|
| 11122010025676 | Ahorro General | Santa Cruz |

**Pozo:** la cuenta 11122010025676 aparece junto a las de Blackbox en el mismo
banco (Santa Cruz) y el colector la trae. Se incluyó por error en una sesión y
el usuario lo detectó. Verificar `credential_ref` o este mapa antes de filtrar.

## Perfume Labs

`credential_ref` contiene `PerfumeLabs` o `Perfume Labs`.

Cuentas en Banreservas, BHD y Popular — son de Perfume Labs, no de Blackbox.

## Erick Rodriguez (cuentas personales)

`credential_ref` contiene `Erick`.

Cuentas en Banreservas, BHD y Popular — son personales, no de la empresa.
