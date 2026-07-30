---
name: consultar-banco
description: "Consulta los movimientos bancarios reales de la empresa: entradas, salidas, saldos y de quién vino cada transferencia. Sólo lectura."
version: 1.0.0
author: QualiaConta
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [Contabilidad, Banco, OpenBanking, Conciliación]
prerequisites:
  env: [OPENBANKING_DSN]
  commands: [psql]
---

# Consultar el banco

Los movimientos los recoge el colector OpenBanking todos los días desde Popular,
BHD y Banreservas, y quedan en una base de la que sólo podés **leer**.

```bash
psql "$OPENBANKING_DSN" -c "select ..."
```

Tenés acceso a exactamente dos tablas. Las credenciales de los bancos están en
la misma base y **no** las podés leer — si lo intentás, la base responde
`permission denied`. Eso es correcto y no hay que buscarle la vuelta.

## Las dos tablas

`openbanking_accounts` — una fila por cuenta bancaria:

| Columna | Qué es |
|---|---|
| `banco` | `popular`, `bhd`, `banreservas` |
| `numero` | número de cuenta |
| `nombre` | alias legible |
| `moneda` | `DOP`, `USD` |
| `ultimo_saldo` · `ultima_sync_at` | saldo y cuándo se actualizó |

`openbanking_transactions` — un movimiento por fila:

| Columna | Qué es |
|---|---|
| `monto` | **con signo**: negativo es débito, positivo es crédito |
| `fecha_posteo` · `fecha_efectiva` | fechas del movimiento |
| `descripcion` | texto del banco |
| `balance` | saldo corrido después del movimiento |
| `banco` · `cuenta_numero` | de qué cuenta es |
| `cuenta_origen` · `nombre_origen` | quién envió, cuando el banco lo expone |
| `nro_referencia` · `nro_cheque` | referencias |

## Lo que hay que saber antes de sumar

**El monto lleva signo.** Para el total que entró: `sum(monto) where monto > 0`.
Si sumás todo sin filtrar, entradas y salidas se cancelan y el número no
significa nada.

**`nro_cheque` NO es único.** En el Popular se repite entre filas distintas. No
lo uses para identificar un movimiento; para eso está `id`.

**Las transferencias entre cuentas propias ya están descartadas** por el
colector antes de guardar. No aparecen, y está bien: mover plata de tu cuenta a
tu otra cuenta no es ingreso ni gasto.

**El colector piensa en cuentas, no en empresas.** Qué cuenta pertenece a qué
empresa está en `/mapa-cuentas.yaml`. **Si una cuenta no figura ahí como de esta
empresa, no la mires ni la incluyas en ningún total** — pertenece a otra empresa
y mezclarlas es el error más grave que podés cometer acá.

## Ejemplos

Entradas del mes, por cuenta:

```sql
select banco, cuenta_numero, sum(monto)
from openbanking_transactions
where monto > 0 and fecha_posteo >= date_trunc('month', current_date)
group by 1,2 order by 3 desc;
```

Buscar un pago de un cliente:

```sql
select fecha_posteo, monto, descripcion, nombre_origen
from openbanking_transactions
where monto > 0 and descripcion ilike '%nombre%'
order by fecha_posteo desc limit 20;
```

## Al responder

Di siempre **de qué cuentas** salió el número y **qué período** cubriste. "Entró
un millón" sin decir de qué cuenta ni de qué mes no le sirve a nadie.

Si el rango pedido cae fuera de lo que el colector tiene guardado, dilo. Hoy
arranca a mediados de junio de 2026; preguntar por marzo va a devolver vacío, y
vacío no es cero.
