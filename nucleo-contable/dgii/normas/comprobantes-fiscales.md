# Comprobantes fiscales — NCF y e-CF

- **Rango:** norma
- **Fuente:** Norma General 05-2019 (e-CF); Ley 32-23 de Facturación Electrónica;
  guías oficiales de la DGII sobre comprobantes fiscales
- **Revisado:** 2026-07-30

El tipo de comprobante no es un dato administrativo: **determina si el ITBIS de
una compra se puede tomar como crédito fiscal y cómo entra la operación al 606**.
Es lo primero que hay que leer de una factura.

## Tipos de comprobante

| Código | Tipo | Para qué |
|---|---|---|
| **31** | Crédito Fiscal | Ventas a contribuyentes. **Es el que permite tomar el ITBIS como crédito** |
| **32** | Consumo | Ventas a consumidor final. No da derecho a crédito fiscal |
| **33** | Nota de Débito | Aumenta el valor de un comprobante ya emitido |
| **34** | Nota de Crédito | Disminuye o anula el valor de un comprobante ya emitido |
| **41** | Compras | Lo emite el comprador al adquirir de Personas Físicas no registradas. Obliga a retener el 100% del ITBIS |
| **43** | Gastos Menores | Gastos pequeños sin comprobante del proveedor |
| **44** | Regímenes Especiales | Ventas a contribuyentes con régimen especial |
| **45** | Gubernamental | Ventas al Estado |
| **46** | Exportaciones | Ventas al exterior |
| **47** | Pagos al Exterior | Pagos a beneficiarios del exterior |

La consecuencia práctica: una factura tipo **32** de un proveedor no da crédito
fiscal por más ITBIS que muestre. Si llega una 32 de una compra que debía ser
31, hay que pedir la sustitución antes de registrar, no después.

## Formato del e-CF

Trece caracteres: la letra **E**, dos dígitos de tipo y diez de secuencia.
Ejemplo de forma: `E310000000001`.

Sólo pueden emitir e-CF los contribuyentes **certificados previamente** por la
DGII (Norma General 05-2019).

## Calendario de migración a e-CF

La Ley 32-23 de Facturación Electrónica hace obligatorio el e-CF por fases,
según el tamaño del contribuyente.

> **⚠️ VERIFICAR para cada empresa.** Según lo publicado por la DGII, las
> pequeñas, micro y no clasificadas tienen plazo hasta el **15 de noviembre de
> 2026** — una prórroga de seis meses publicada en mayo de 2026. Los tramos
> anteriores ya vencieron.
>
> Hay que confirmar en qué clasificación cae cada empresa y qué fecha le
> corresponde. No es un dato de contexto: si a la empresa ya le venció el plazo,
> emitir NCF en papel deja de ser válido.

## Validación

La DGII expone consulta de NCF y e-CF en su portal. Antes de registrar una
compra vale validar que el comprobante existe y está vigente — un NCF vencido o
inválido se rechaza en el 606 y hay que rehacer el período.

## Lo que hay que verificar todavía

- En qué clasificación de contribuyente cae Blackbox y qué fecha de e-CF le
  aplica.
- Si ADM Cloud ya ingesta los e-CF recibidos o hay que buscarlos en la DGII.
- Si existe consulta automatizable de validez de NCF, o hay que ir por el portal.
