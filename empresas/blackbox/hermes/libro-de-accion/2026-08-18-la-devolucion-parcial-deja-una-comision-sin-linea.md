# Una devolución que vuelve corta deja una comisión que no tiene línea en el banco

- **Fecha:** 2026-08-18
- **Caso:** Se le pagó a un proveedor desde la cuenta **Suplidores USD** con la
  cuenta de destino equivocada. El banco devolvió el envío, pero **no completo**:

  | Fecha | Movimiento | Monto | Ref. banco |
  |---|---|---|---|
  | 23/07/26 | «Debito Por Transferencia» | **−US$1.127,06** | 21779709 |
  | 30/07/26 | «Transferencia Recibida de: TRANSF ENV Y DEV FEN**21779709** DE BLACKBOX…» | **+US$1.121,37** | 21861344 |

  El banco se quedó con **US$5,69**. Ese monto **no tiene una tercera línea en el
  estado de cuenta**: viaja ya descontado adentro del retorno del 30/07. Los dos
  movimientos figuran en la mesa con el badge «Devuelta», o sea que el cruce de
  reversos de `admcloud-conciliacion-entradas` ya los emparejó —por la ronda de
  **referencia citada**, que es la que tolera montos distintos justamente porque
  el banco se queda la comisión al devolver—, y ninguno de los dos está
  registrado en ADM.

  Lo que trajo el caso a decisión fue la pregunta correcta del dueño: si se
  asienta la entrada y la salida, la diferencia **tiene que asentarse de alguna
  manera**, y la conciliación no puede cerrar porque no existe un tercer
  movimiento contra el cual cruzarla.
- **Decisión:** **el par bruto no se asienta; la retención sí, sola, como el
  cargo bancario que es.** En dos tramos independientes, que nunca van en la
  misma propuesta:

  1. **El par se neutraliza.** Verificado antes por P-001 que el envío del 23/07
     nunca llegó a asentarse en ADM, la operación económica no ocurrió: salió y
     volvió. Ni la salida ni el retorno se registran. Si en otro caso el envío
     **sí** estuviera asentado, ese tramo es un reverso contra su original
     (P-002), no una cuenta parecida.
  2. **La retención se asienta por su neto**, US$5,69, como `BankCharges` en
     cargo: débito a la cuenta de cargos bancarios del plan vivo, crédito a
     Suplidores USD. `Reference` = el `banco_tx_id` del **retorno** (21861344),
     que es el movimiento que la contiene.

  Queda dictado además que **la diferencia se calcula** —`|salida| − |retorno|`
  del par— y no se lee de ningún texto del banco, y que el anti-duplicado va por
  ese par y **nunca por monto suelto**.
- **Por qué:** **el par no se anula solo, y tratarlo como si se anulara falla en
  las dos direcciones a la vez.** Hoy la conciliación los rotula «se anulan con
  su reverso»: es cierto para el par y falso para la plata. Si el par se da por
  cerrado, se pierde un gasto real de US$5,69 **y** la cuenta de banco queda
  descuadrada exactamente por ese monto, para siempre — el saldo del banco bajó
  US$5,69 y el de ADM no. Es el descuadre más difícil de encontrar meses después,
  porque las dos líneas grandes que lo produjeron están marcadas como resueltas.

  **La cuenta puente que parecía la respuesta obvia no hacía falta.** La primera
  lectura de este caso fue asentar la salida contra una cuenta de paso, y el
  retorno contra la misma cuenta partido en banco + gasto, dejando la puente en
  cero. Cuadra, pero **crea una cuenta nueva para representar una operación que
  no ocurrió**, y choca de frente con P-005: antes de crear, probar que no
  existe. Con el envío sin asentar en ADM, la puente nace y muere dentro del
  mismo par sin haber informado nada — dos asientos de US$1.127 para explicar un
  gasto de US$5,69. El tratamiento corto dice lo mismo con la mitad de las
  partidas y usa una cuenta que ya existe.

  **La materialidad no aplica acá, y conviene dejarlo escrito** porque US$5,69
  invita a redondearlo a cero: no es una estimación que se pueda despreciar, es
  el movimiento literal del saldo. Un monto que mueve la cuenta de banco se
  asienta aunque sean centavos, o la conciliación del mes deja de cerrar.

  **La contraparte es el banco, y por eso este hecho SÍ tiene documento.** Es la
  diferencia con H-06 y H-07: ahí la plata entra de un cliente o de un inquilino
  y `BankCharges` sería disfrazar un hecho de tercero. Acá quien se quedó la
  plata es el banco, cobrando por un servicio que prestó, así que H-12 aplica
  entero y sin la excepción. El dictamen termina en un botón aprobable, no en
  trabajo manual para el que aprueba.

  **La moneda extranjera esconde una segunda diferencia que no es comisión.** La
  cuenta es USD y el libro va en pesos. Mientras el par se neutraliza, no nace
  ninguna diferencia cambiaria: sólo se convierte el asiento de US$5,69, a la
  tasa del 30/07. Pero en el caso donde el tramo 1 hay que reversarlo, el
  original entró a la tasa de una fecha y el reverso sale a la de otra, y esa
  diferencia **no es lo que el banco cobró**. Meterla en el mismo renglón infla
  el gasto bancario con plata que nadie cobró.
- **Sostén:** Método: dictamen del dueño sobre un caso vivo, verificado contra
  el mecanismo real de las dos puntas.
  - **El emparejamiento está verificado en el código, no supuesto**:
    `conciliarReversos` en `admcloud-conciliacion-entradas` (repo Labs_Inv) tiene
    dos rondas, y la primera —«reverso, referencia citada»— corre **con
    `montoExacto: false` a propósito**, con estos mismos importes citados en su
    comentario: al devolver una transferencia el banco se queda la comisión, así
    que la referencia es prueba suficiente por sí sola. Por eso el par cruzó pese
    a diferir en US$5,69, y por eso el sistema ya sabe cuál es el par.
  - **El dato para calcular la retención ya viaja**: cada movimiento sale al JSON
    con `reverso_monto` junto a su `monto`, así que la diferencia es una resta
    sobre lo que la conciliación ya entrega. Lo que falta es de la superficie, no
    del dato: el resumen suma las devueltas como anuladas y no muestra el neto, y
    el detector no abre la sugerencia solo. Queda anotado como pendiente en el
    INDEX de la doctrina, que es donde va el estado del mundo.
  - Doctrina que sostiene cada tramo, ya ratificada: **P-001** (verificar en ADM
    antes de asumir el saldo), **P-002** (el reverso contra su original),
    **P-004** (la cuenta por la naturaleza del hecho), **P-005** (probar que no
    existe antes de crear), **H-01** (el cargo bancario y su cuenta) y **H-12**
    (el vehículo `BankCharges`, con su alcance de contraparte-banco).
- **Aprobó:** *pendiente de ratificación de C.Araujo.* Mientras no esté firmada,
  H-13 se lee pero **no automatiza**: el contable detecta el par corto, deja los
  números y **pregunta**.
- **Alcance:** Blackbox SRL y toda empresa que monte este núcleo, desde la fecha
  de ratificación, sobre cualquier par salida↔retorno que el cruce de reversos
  empareje con montos distintos, en cualquier cuenta y en cualquier moneda.
  Incluye el caso simétrico —una entrada que se devuelve y sale por menos—, donde
  cambia el signo de las dos patas del par pero no el tratamiento de la
  retención.

  **Qué NO cubre y va al humano igual:** (a) par emparejado por la ronda de
  **monto exacto** con diferencia dentro de la tolerancia de US$0,50 — ahí no se
  sabe si es retención o redondeo, y una tolerancia no es una comisión; (b) envío
  **sí asentado** en ADM, donde el tramo 1 es un reverso y decide P-002 con el
  original en la mano; (c) diferencia cambiaria sin cuenta identificada en el
  plan vivo; (d) par cuya diferencia supere lo que una comisión bancaria puede
  ser razonablemente — una devolución que vuelve por la mitad no es una retención,
  es otra cosa, y adivinar cuál es exactamente lo que esta entrada prohíbe.
- **Deroga:** nada. H-13 es un hecho nuevo. No toca H-02, que sigue rigiendo el
  reverso de un CARGO contra su cargo original: ahí lo que se devuelve es una
  comisión del banco, no un envío a un tercero, y el par cierra completo.
