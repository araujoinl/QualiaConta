# Combustible estación Nuevo Milenio — NCF corregido por el humano

**Fecha:** 2026-08-03
**Aprobó:** Victor, por la mesa web
**Documento ADM:** FP00001089 (VendorBills, uuid 6fa9b390-c62f-481f-a007-08def10be22b)
**Trabajo mesa:** 3dda44b8-6d5b-40ed-96a0-2b403beaf839

## Hecho

Factura de combustible (gasolina premium, 2.19 gal) de **ESTACION DE SERVICIOS H
E NUEVO MILENIO S R L** (RNC 101830719), NCF **B0100857686**, fecha 2026-07-08,
total **RD$750.00** (exento de ITBIS — combustible).

Registrada en ADM como **FP00001089**, cuenta **620.11 Combustible**, tipo de
gasto **02 Gastos por Trabajos, Suministros y Servicios**.

## Criterio

1. **El preparador leyó mal RNC y NCF.** El dossier auto-extraído traía RNC
   131188648 (BlackBox SRL, el cliente) y NCF B0100857605, que salía NO VALIDO en
   DGII. El humano corrigió ambos:
   - RNC emisor: **101830719** (ESTACION DE SERVICIOS H E NUEVO MILENIO SRL)
   - NCF: **B0100857686** → VIGENTE en DGII (vigencia 31/12/2026).
   El NCF corregido sí sirve como crédito fiscal.

2. **Aritmética del surtidor.** El recibo imprime galones (2.19) y precio/gal
   (341.10) que multiplican 747.01, pero el MONTO y el TOTAL impresos son ambos
   750.00. La diferencia (2.99) es redondeo/ajuste de bomba, no un renglón
   faltante. La línea se registra con el MONTO impreso (750.00), galones en la
   descripción. El humano confirmó el total de RD$750.00.

3. **Cuenta 620.11 Combustible** por precedente: 51 de 53 facturas históricas
   de este RNC en `agg:proveedor-cuentas.json#101830719`.

## Alcance

- **Cuando el dossier del preparador lea como RNC emisor el RNC del cliente
  (BlackBox), siempre hay que sospechar lectura errónea y no proponer gasto no
  admitido a ciegas:** el RNC del cliente aparece impreso como comprador, y el
  preparador lo confunde con el emisor. Releer el documento (o preguntar) antes
  de descartar el NCF.
- **Recibos de combustible por surtidor:** los galones × precio/gal no siempre
  multiplican exacto al MONTO impreso por redondeo de bomba. La línea se
  registra con el MONTO impreso; la diferencia < RD$5 sin patrón conocido no es
  motivo de pregunta si el humano confirma el total.
