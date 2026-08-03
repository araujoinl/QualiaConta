# Factura HUMANO SEGUROS, S. A — póliza RC Auto Exceso, seguro de vehículo

**Registrada en ADM como FP00001067** (UUID a86ecf55-70d8-4707-8e3e-08def10be22b)

- **Fecha:** 2026-07-05
- **Proveedor:** HUMANO SEGUROS, S. A (RNC 102017174) — ya existía en ADM
- **NCF:** E310000514080 (e-NCF; timbre DGII no verificable: fecha de firma incompleta en el PDF, sin hora)
- **Tipo de gasto (606):** 11 Gastos de Seguros
- **Documento ADM:** VendorBills
- **Moneda:** DOP
- **Total factura:** 1,856.00
- **ITBIS declarado:** 0.00 (los seguros no llevan ITBIS; llevan ISC)
- **Término de pago:** Al contado
- **Aprobó:** C.Araujo, por la mesa web
- **Registrada:** 2026-08-03

## Líneas registradas

| Descripción | Cuenta | Cuenta nombre | Precio | ITBIS |
|---|---|---|---|---|
| Prima póliza RC Auto Exceso 30-35-89255 (Renovación 05/07/26-05/07/27, Jetour 2025) | 660.01 | Seguros de Vehículos | 1,600.00 | exento |
| ISC 16% sobre prima (Ley 146-02) | 620.09 | Gasto de Impuesto Selectivo al Consumo | 256.00 | exento |

Subtotal items: 1,856.00 — cuadra con el documento.

## Notas

- **La naturaleza del bien mandó sobre el precedente dominante del proveedor.**
  Humano Seguros (RNC 102017174) tiene cuenta dominante **611.18 Seguro Médico**
  en el histórico (seguro médico ARS). Pero esta factura es **Responsabilidad
  Civil Auto Exceso** — un seguro de vehículo, no de salud. Se clasificó en
  **660.01 Seguros de Vehículos** por la naturaleza del bien asegurado (auto),
  con `metodo='precedente'` apoyado en `agg:proveedor-cuentas.json#102017174`
  más el plan de cuentas, no en la cuenta dominante ciega.
- **El ISC 16% es el impuesto selectivo propio de los seguros** (Ley 146-02),
  no ITBIS. Va como ítem propio a **620.09 Gasto de Impuesto Selectivo al
  Consumo** (1 uso histórico de este mismo proveedor). No hay ITBIS en el
  documento.
- **Asegurado Blackbox SRL** (RNC 131188648); facturada a Banco Múltiple Santa
  Cruz (RNC 102012921). Patrón histórico confirmado: los 16 usos de la cuenta
  660.01 provienen de Banco Múltiple Santa Cruz S.A.
- **Timbre DGII no verificable:** el PDF trae la fecha de firma sin hora
  (01/06/2026), y la consulta de timbre la exige completa. No es un NCF
  inválido — es una limitación de la lectura del PDF. Queda registrado con
  confianza 0.85.
- **Contacto del proveedor (del documento):** Julissa Rodriguez — Gerencia de
  Suscripción, (809) 476-3535, segurosgeneralesemisiones@humano.com.do.

## Alcance

**Seguros del proveedor Humano Seguros (y en general de cualquier aseguradora)
cuyo bien asegurado sea un vehículo** se clasifican en **660.01 Seguros de
Vehículos**, aunque el proveedor tenga cuenta dominante 611.18 Seguro Médico
por su volumen de facturas ARS. **La cuenta sigue a la naturaleza del bien
asegurado, no al proveedor.** El ISC del 16% sobre la prima (Ley 146-02) va
como ítem propio a **620.09**, y no hay ITBIS. Tipo de gasto 606: **11 Gastos
de Seguros**.
