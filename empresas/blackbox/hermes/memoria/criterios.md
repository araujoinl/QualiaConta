---
estado: ratificado
aprobo: C.Araujo — C-001 corregido por él en sesión real (julio 2026), C-002 dictado por chat el 2026-08-07 y corregido por él el mismo día (la forma `BankCharges` en crédito queda derogada: un cobro de cliente no es un crédito bancario)
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
devengarse —anticipos de renta y depósitos en garantía de renta— se asienta
con débito al banco y crédito a **220.06 «Depósitos en Garantía por Renta»**
(pasivo). Mientras «Adelanto de Clientes» siga sin código contable, los
anticipos de renta también van a 220.06 (decisión del contador: un solo pasivo
de renta; la distinción anticipo/garantía vive en el `detalle` del asiento). El
destino después depende de cuál de los dos es (dictado del contador, chat
2026-08-07):

- **Anticipo** (renta pagada por adelantado que se consume): al devengarse cada
  mes se reclasifica — débito 220.06, crédito **411.16 Renta Inmuebles**,
  reconociendo el ITBIS que corresponda. El monto recibido trae los impuestos
  incluidos, no se le suma nada.
- **Garantía** (caso Formax, los RD$180,000): **cero devengo — «se quedan hasta
  que desaloje»**. Permanecen en 220.06 la vida entera del contrato; recién al
  desalojo se devuelven (débito 220.06, crédito banco) o se aplican a
  renta/daños (débito 220.06, crédito 411.16 con su ITBIS en ese momento).
  Reclasificarlos mensualmente sería reconocer ingreso de plata que sigue
  siendo ajena.

**Qué documento: NINGUNO de los que el agente puede escribir hoy — se
pregunta.** El asiento de arriba es correcto; el tipo de documento con que
llega a ADM no lo decide el contable solo. `Journals` está bloqueado por el
candado de caja, y **`BankCharges` en crédito NO es una salida válida**: un
depósito de un inquilino no es un crédito bancario, porque la contraparte es el
cliente y no el banco (H-06/H-07 del núcleo). Hasta que el rol de ADM habilite
un documento de entrada de tercero, estas operaciones las registra un humano y
el contable abre un evento `pregunta` con el movimiento y el tratamiento.

**Corrección del 2026-08-07 (C.Araujo, por chat).** Este criterio estuvo unas
horas diciendo lo contrario: que la forma ejecutable era `BankCharges` en
crédito. Nació de una racionalización del propio contable —escribió en su
`detalle` que C-002 mandaba `Journals`, que el sistema lo bloqueaba, y que por
eso re-etiquetaba— y se dio por ratificada porque la propuesta se aprobó en la
mesa. **Aprobar una propuesta no ratifica el razonamiento que la armó.** El
resultado fue el **CB00000258**: un depósito en garantía de RD$180,000 asentado
en «Bancos → Cargos Bancarios». Su corrección en ADM la decide Carlos (anular y
re-registrar es humano; el rol del agente niega Void).

**Evidencia:** caso Formax 2026-08-07 (RD$180,000, anticipo de 2 meses de
renta de nave industrial, impuestos incluidos). Plan vivo verificado ese día:
216 cuentas, 220.06 existente; 220.01 es Nómina por Pagar (ocupada — sugerirla
fue el fallo que motivó la regla del vecindario en la doctrina). Principio
contable: H-06/H-07 del núcleo (`nucleo-contable/doctrina/conciliacion-hechos.md`).

**Alcance propuesto:** Blackbox SRL, todo ingreso por renta de nave/local
cobrado por adelantado. Si «Adelanto de Clientes» recibe código propio en ADM,
este criterio se revisa para separar anticipo de garantía (no se parchea en
silencio).
