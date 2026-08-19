# Salida de la transferencia al exterior · Banco Suplidores USD → Avance a proveedores — US$1.127,06

- **Fecha:** 2026-08-18
- **Caso:** Salida de la transferencia al exterior · Banco Suplidores USD → Avance a proveedores — US$1.127,06
- **Decisión:** BankCharges US$1,127.06. Renglones: débito 1,127.06 → 150.05 Avance a proveedores; crédito 1,127.06 → 102.01 Banco Suplidores USD 404 DocID CB00000289.
- **Por qué:** Registro un Cargo bancario por US$1.127,06: deja asentada en los libros la salida del 23/07 de la cuenta Suplidores USD, que hoy no existe en ADM y por eso no concilia.

Sostén: Caso #6, fila banco:f82bc3fa-cf1e-4a64-90de-a94c347b98af (Débito Por Transferencia, ref 21779709). No hay factura ni pasivo en ADM detrás del envío: sin espejo en bill-payments/account-payments, sin proveedor «BLACKBOX SRL» en ADM y su RNC 131262563 NO existe en el padrón DGII (consultado hoy: «no se encuentra inscrito»). Al no existir la contraparte registrada, la partida va a 150.05 Avance a proveedores: es un tránsito que espera aclararse, y el paso hermano de la entrada lo cancela. Hecho H-05-vecino: movimiento nacido en el estado de cuenta con el banco ejecutando el débito — pregunta 1 del protocolo; el candado de Journals sobre caja lo confirma. banco_tx_id puesto para que la conciliación descarte este movimiento.
- **Sostén:** Método: razonado
- **Aprobó:** C.Araujo, por la mesa web
- **Alcance:** — (documenta este caso; sin alcance no automatiza)
- **Deroga:** —
