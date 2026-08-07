# Rama «registro pendiente» — la lee la fila aprobada que el poller no pudo registrar en ADM.

## Si el motivo es `registro_pendiente`

El poller tiene un trabajo en `aprobada` sin `registro_adm.docid` que él no pudo
registrar. Tres razones posibles, y conviene saber cuál antes de actuar:

1. **El script murió con un motivo.** El más importante es el `AMBIGUO` del
   cargo bancario: hay un gemelo en ADM que nadie reclama y el script se niega a
   adivinar. Eso NO se resuelve reintentando — se resuelve preguntando (ver
   «REGLA DURA: un documento de ADM es «el tuyo» solo si podés PROBARLO» en
   `references/ref-registro-adm.md`).
2. **El `documento_adm` no tiene registro automático.** Hoy sólo lo tienen
   `VendorBills` y `BankCharges`; una transferencia o un `Journals` caen acá y
   los registrás vos, con todos los cuidados de «Cargo bancario, transferencia
   o asiento: sin NCF no hay red contra el doble registro», en
   `references/ref-registro-adm.md`.
3. **El registro se cayó sin dejar rastro** y lo agarró el barrido de los 10
   minutos. Pasó el 2026-08-03 con cuatro facturas: z.AI devolvió 429 durante
   una ráfaga de aprobaciones, los turnos se cayeron sin escribir nada, y las
   filas quedaron huérfanas.

Hacé exactamente lo que dice `references/ref-registro-adm.md` —
`abrir-trabajo.sh` te lo imprimió junto con este archivo; si no lo ves, hacele
`cat`—: leé la fila, registrá en ADM con el script, subí el adjunto, escribí el
libro (el `insert` está en el núcleo) y cerrá la fila. Dos cuidados propios de
un reintento:

- **Puede estar registrada de verdad y vos no haberlo anotado.** En una FACTURA
  eso se resuelve solo: el script lo chequea (`verificar_duplicado` pagina
  VendorBills por NCF y por referencia) y ADM también frena el duplicado, así
  que corré el script y leé su mensaje en vez de suponer. Si te dice que ya
  existe, no re-registres: el NCF es único por emisor, así que ese documento es
  este trabajo — guardá su DocID en `registro_adm` y cerrá la fila.

  **En un cargo, transferencia o asiento NO vale el mismo razonamiento.** Sin
  NCF, «encontré uno igual» no significa «es el mío»: significa que hay dos
  movimientos que se ven iguales, que es lo normal en un banco. Solo lo adoptás
  si el documento trae TU `banco_tx_id` en `Reference`; si no podés probarlo,
  preguntá y dejá la fila en `esperando_respuesta`. Ver «REGLA DURA: un
  documento de ADM es «el tuyo» solo si podés PROBARLO» en
  `references/ref-registro-adm.md` — se saltó una vez y costó el `CB00000169`
  duplicado.
- **Si el libro ya tiene su entrada de la corrida anterior, no la dupliques.**
  El libro es append-only: revisá `qualia_libro` por `trabajo_id` antes de
  escribir.

Si el registro vuelve a fallar por un dato que falta y no es transitorio (el
proveedor no se puede crear, la propuesta no trae la razón social de DGII),
dejá el trabajo en `error` con `error_detalle` legible. El poller deja de
reintentar a las 2 horas, así que un trabajo mudo es un trabajo perdido:
el `error_detalle` es lo que lo hace visible en la web.

