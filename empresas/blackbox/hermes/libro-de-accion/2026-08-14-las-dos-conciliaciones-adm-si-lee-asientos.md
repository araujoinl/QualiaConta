# Las dos conciliaciones: ADM sí lee asientos, la mesa no

- **Fecha:** 2026-08-14
- **Caso:** Verificación de la premisa que sostiene el candado `qualia_trabajos_journal_no_toca_caja`
- **Decisión:** «La conciliación» son DOS sistemas distintos y hasta hoy la doctrina los trataba como uno. (a) La conciliación de la **mesa** —edge function `admcloud-conciliacion-entradas` de Labs_Inv— NO lee asientos: sus fuentes son `CashInvoices`, `CashReceipts` y `BankBankTransfers` del lado entrada, y `BillPayments`, `Expenses`, `AccountPayments` y `BankCharges` del lado salida. (b) El módulo **`BankReconciliations` de ADM** SÍ los lee y los concilia normalmente. Cuando una regla diga «la conciliación», tiene que decir cuál.
- **Por qué:** La frase «la conciliación no lee /api/Journals» aparecía en `rama-facturas-1.md`, en el comentario de la migración `20260807185500` y en el libro (entradas CB00000258 y CB00000259), los tres citándose entre sí y ninguno verificado contra ADM. Se consultó `GET /api/BankReconciliations` sobre 25 conciliaciones y aparecen **32 filas con `DocType: "JOURNAL"`**, todas con `TransAccountRowID` poblado — ADM aparea contra la **línea** del asiento que toca la cuenta de banco, no contra el total del documento. Entre ellas el ED00000169 de RD$2.497.600 («Desembolso de préstamo», fila 1 de la CCB00000108) y el ED00000148 de RD$4.000.000.

  Dos consecuencias que corrigen decisiones previas, sin tocarlas (regla 2 del repo):

  1. Los precedentes **ED00000096 / ED00000097 / ED00000127 SÍ sirven** en ADM — el 127 está conciliado en la CCB00000079. La afirmación contraria de `rama-facturas-1.md` era falsa y ya se corrigió ahí.
  2. La justificación escrita en la entrada del **CB00000258** («va como BankCharges porque es el documento que la conciliación sí cruza») es válida para la pantalla de la mesa y **falsa para los libros de ADM**. La decisión de fondo de esa entrada no cambia: un depósito de un inquilino no es un crédito bancario (H-06/H-07), y por eso ese registro sigue siendo incorrecto por su propio motivo, no por éste.

  El ED00000183 (cashback Visa 1877) tampoco quedó como diferencia eterna por ser un asiento: **la última conciliación registrada en ADM es del 2026-03-31**, así que no existe ninguna que cubra agosto.

  El candado NO se levanta. Mientras la conciliación de la mesa no lea asientos, un `Journals` contra caja deja el movimiento como «Sin registro en ADM» en la pantalla que se usa a diario, y eso basta para no proponerlo. Lo que cambia es el motivo y la salida cuando frena: si la contraparte es un tercero, es un evento `pregunta`, nunca un re-etiquetado a `BankCharges`.
- **Sostén:** Método: verificado por API contra ADM Cloud (`GET /api/BankReconciliations`, 25 documentos, 2026-08-14) y por lectura de `FUENTES_ADM` / `FUENTES_GASTO` en `admcloud-conciliacion-entradas/index.ts` del repo Labs_Inv
- **Aprobó:** C.Araujo, por chat
- **Alcance:** Toda regla, criterio o dictamen que invoque «la conciliación» para elegir tipo de documento en Blackbox SRL. Obliga a nombrar cuál de las dos. Se revisa si la mesa incorpora `Journals` a su cruce (ver paso 4 de la propuesta del 2026-08-14).
- **Deroga:** La afirmación «los precedentes ED00000096 / ED00000097 / ED00000127 no sirven porque la conciliación no lee /api/Journals», de `skills/mesa-de-trabajo/references/rama-facturas-1.md`. No deroga ninguna entrada del libro.
