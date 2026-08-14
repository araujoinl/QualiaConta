# El contable NO anula: puede técnicamente, y no debe

- **Fecha:** 2026-08-14
- **Caso:** Sondeo de qué puede hacer el rol de verdad, a raíz de la pregunta «¿dónde no pudo lograr cosas?»
- **Decisión:** **el contable no anula ningún documento en ADM, nunca.** Cuando un documento suyo esté mal, abre el evento y lo anula un humano; él re-registra después. La regla no cambia: cambia su fundamento, porque el que estaba escrito era falso.
- **Por qué:** hasta hoy la doctrina decía «el rol del agente niega Void» en `criterios.md` y en `docs/plan-encendido-escritura.md`. Sondeado el 2026-08-14 contra el GUID inexistente `00000000-…-0001`, que no puede mutar nada:

  | Endpoint | Respuesta | Lectura |
  |---|---|---|
  | `VendorBills/Void` | «Este documento no existe» | el permiso PASA |
  | `BankCharges/Void` | «Este documento no existe» | el permiso PASA |
  | `Journals/Void` | «Este documento no existe» | el permiso PASA |
  | `BillPayments/Void` | `Unauthorized` | negado de verdad |
  | `AccountPayments/Void` | `Unauthorized` | negado de verdad |

  Control contra un endpoint inventado (`InventadoXYZ/Void`): HTTP 404 con otra forma, así que no es un falso positivo de ASP.NET.

  **Y la causa de fondo:** el rol recortado `QualiaConta-Registro` que especifica §1.1 del plan de encendido **nunca se creó**. `ADMCLOUD_ROLE` y `ADMCLOUD_REG_ROLE` apuntan los dos al mismo rol, `Contabilidad Digital`. El «límite duro del servidor» que el SPEC da por puesto no existe para tres de los cinco documentos que el agente escribe.

  Por eso la regla se escribe ahora como **«podés y no debés»**, que es lo único que aguanta. Una prohibición apoyada en «no tenés permiso» se derrumba el día que el agente descubre que sí lo tiene, y ahí no queda regla: queda un agente que se siente autorizado. Es el mecanismo exacto del CB00000258 — el candado frenó y, en vez de parar, se buscó otra vía.

  Anular toca el libro fiscal oficial y no es reversible: el documento queda con lápida, sale de balances y su número no se reutiliza. Esa decisión es de un humano aunque la API la deje pasar.
- **Sostén:** Método: verificado por sondeo negativo contra ADM Cloud el 2026-08-14, con los dos roles del `.env` y con control de falso positivo.
- **Aprobó:** C.Araujo, por chat («no debe anular»)
- **Alcance:** Blackbox SRL y toda empresa que monte este núcleo. Vale para los cinco documentos que el agente escribe, tenga o no permiso la API. Se revisa **sólo** si se crea el rol recortado y el límite pasa a vivir en el servidor; ahí esta entrada deja de ser lo único que lo sostiene.
- **Deroga:** la afirmación «el rol del agente niega Void», de `criterios.md` y de `docs/plan-encendido-escritura.md` §5.
