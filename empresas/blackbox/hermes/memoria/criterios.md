---
estado: ratificado
aprobo: C.Araujo — C-001 corregido por él en sesión real (julio 2026), C-002 dictado por chat el 2026-08-07
evidencia: conciliación de entradas julio 2026 (configuracion_conciliacion_entradas.md) y caso Formax 2026-08-07
---

# Criterios transversales

Reglas numeradas (C-001, C-002…) que aplican a más de un proveedor o documento.
Cada criterio lleva: enunciado, evidencia verificable y alcance propuesto. El
C-001 de abajo es la semilla de formato que los lotes deben imitar.

Un criterio nuevo entra como borrador marcándolo en su propio título
(`## C-00X — … [BORRADOR]`) y no es precedente hasta que Carlos lo apruebe.

---

## C-001 — Pagos con tarjeta llegan al banco netos de comisión 5.395%

**Enunciado:** los cobros de clientes vía tarjeta de crédito aparecen en el
banco como `Por Transferencia Ach-Ach Recibida: Servicios Digita - …` y el
monto acreditado ya trae descontada la comisión del **5.395%**. Para conciliar
contra ADM hay que revertir al monto original:

```
monto_original = monto_banco / (1 - 0.05395)
```

No se puede cruzar por nombre (el banco dice "Servicios Digita"; ADM dice el
cliente real): solo monto original + fecha, en rondas separadas después de las
normales.

**Evidencia:** `configuracion_conciliacion_entradas.md` §3 y el script
`memoria/scripts/conciliar-entradas.py` (parámetro `comision_tarjeta: 0.05395`).
Caso verificado: banco 6,663.31 → original 7,043.30 vs ADM 7,043.29 (factura al
contado). Regla corregida por Carlos en sesión real de conciliación julio 2026.

**Alcance propuesto:** toda conciliación de entradas de Blackbox SRL; detección
por descripción que contenga `Servicios Digita` / `Servicios Dig`. Si cambia el
adquirente o la tasa, el criterio se revisa (no se parchea en silencio).

---

## C-002 — Renta cobrada por adelantado va al pasivo 220.06

**Enunciado:** dinero de un cliente por renta de nave/local recibido ANTES de
devengarse —anticipos de renta y depósitos en garantía de renta— se registra
con débito al banco y crédito a **220.06 «Depósitos en Garantía por Renta»**
(pasivo). La forma ejecutable del documento depende de dónde nació la plata:
si entró por el estado de cuenta (transferencia/depósito), va como
**`BankCharges` en crédito** — un `Journals` haría el mismo asiento pero el
candado del sistema bloquea asientos sobre cuenta de banco y la conciliación
no lee `/api/Journals`, así que quedaría sin conciliar para siempre
(descubierto y ratificado en el registro CB00000258, 2026-08-07). Mientras
«Adelanto de Clientes» siga sin código contable, los anticipos de renta
también van a 220.06 (decisión del contador: un solo pasivo de renta; la
distinción anticipo/garantía vive en el `detalle` del asiento). Al devengarse
cada mes se reclasifica: débito 220.06, crédito **411.16 Renta Inmuebles**,
reconociendo el ITBIS que corresponda — el monto recibido trae los impuestos
incluidos, no se le suma nada.

**Evidencia:** caso Formax 2026-08-07 (RD$180,000, anticipo de 2 meses de
renta de nave industrial, impuestos incluidos). Plan vivo verificado ese día:
216 cuentas, 220.06 existente; 220.01 es Nómina por Pagar (ocupada — sugerirla
fue el fallo que motivó la regla del vecindario en la doctrina). Principio
contable: H-06/H-07 del núcleo (`nucleo-contable/doctrina/conciliacion-hechos.md`).

**Alcance propuesto:** Blackbox SRL, todo ingreso por renta de nave/local
cobrado por adelantado. Si «Adelanto de Clientes» recibe código propio en ADM,
este criterio se revisa para separar anticipo de garantía (no se parchea en
silencio).
