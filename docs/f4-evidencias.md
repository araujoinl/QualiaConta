# F4 — Evidencias de las precondiciones (plan-f4-registrador.md §11.4)

> **CUTOVER COMPLETO 2026-08-20 (plan corto, OK de Carlos).** Los SIETE tipos
> registran desde `qualia-registrador`: FP/NCP/CB encendidos con backtest
> 33/40 idénticos (7 diferencias = ediciones humanas posteriores, 0 bugs), y
> ED/TE/PP/PC con backtest **63/63 idénticos**. Trigger de 'aprobada' + barrido
> cada 10 min + kill-switch por empresa. El poller cede TODOS los tipos con el
> modo en nube.
>
> **SERVER LIMPIO 2026-08-20 ~14:00 RD.** CodeBox quedó sin NADA de QualiaConta:
> contenedores abajo y borrados, imagen `qualiaconta:local` eliminada,
> `/home/codebox/qualiaconta` borrado (los restos root-owned vía contenedor
> efímero), crontab sin líneas qualia. Respaldo previo de lo no versionado
> (.env + mesa-cache, 137 MB) en `~/Backups/qualiaconta-codebox-20260820-135502.tar.gz`
> de la máquina de Carlos. El alimentador del espejo de facturas (el único cron
> del server que la nube aún necesitaba) quedó portado como `qualia-espejo`
> (cron horario :05, incremental, verificado bajando el espejo en su corrida
> inaugural).
>
> **Huecos que dejó el server, con dueño pendiente:**
> 1. Padrón DGII mensual — **PORTADO 2026-08-20 a GitHub Actions**:
>    `.github/workflows/padron-dgii.yml` corre `mesa/cargar-padron-dgii.sh`
>    (adaptado: llave por entorno, log a stdout) el día 1 de cada mes, 08:00 UTC.
>    Corrida de prueba local del 2026-08-20: leidas=787.020, cargadas=786.975,
>    marca `refresco_padron_dgii` estampada 18:20 UTC — el 1-sep ya no aprieta.
>    Para ACTIVAR falta: secret `SUPABASE_SERVICE_ROLE_KEY` en el repo + push
>    (esperan OK de Carlos). Ojo verificación: los upserts no mueven
>    `actualizado_en` (default solo al insertar); la frescura se lee en la
>    marca de `qualia_config`, no en `max(actualizado_en)`.
> 2. Respaldo local del bucket `qualia-conta` (`respaldo-documentos.sh`): los
>    documentos viven SOLO en Storage (el pg_dump nocturno no cubre buckets).
>    Decidir: sumarlo a `/opt/supabase-backup` del server (pide sudo) u otra vía.
> 3. Alertas por WhatsApp (`alerta-salud.sh`): el cuadre y las escrituras
>    parciales hoy quedan en tablas sin canal humano — es la Fase 3 del plan de
>    profesionalización.

> «Ninguna se da por buena sin evidencia escrita»: este archivo ES el registro.
> Una precondición sin su evidencia acá sigue abierta, diga lo que diga el chat.

| # | Precondición | Estado | Evidencia |
|---|---|---|---|
| 1 | Rol único consolidado | **✅ parcial** | Verificado 2026-08-20 contra el `.env` del server: `ADMCLOUD_ROLE` == `ADMCLOUD_REG_ROLE` == `Contabilidad Digital`, y los usuarios también son el mismo. **Falta**: correr las sondas §1.3 con el rol único y pegar su salida acá. |
| 2 | Default-deny portado a código | **✅** | `_shared/adm.ts` (lista blanca + patrones negados en el cliente, antes de la red). Test: `deno test supabase/functions/_shared/adm.test.ts` — 8/8, SIN `--allow-net`: 20 rutas negadas tiran `ErrorListaBlanca` sin que salga un request (si el código intentara la red, Deno moriría con PermissionDenied y el assert lo delata). |
| 5 | Cron de cuadre 1:1 en verde 14 días | **⏱ reloj corriendo desde 2026-08-20** | Function `qualia-cuadre` desplegada (v2) + cron diario 03:50 UTC (23:50 RD) vía `qualia_disparar`. Corrida #1 (16:35 UTC): 5 rojos — todos falsos positivos de forma (tupla `{Item1:[filas]}` de BankBankTransfers; Journals sin TotalAmount en el listado), corregidos y documentados en `_shared/adm.ts`. Corrida #2 (16:39 UTC): **VERDE** — 38 documentos, 0 rojos, 12 amarillos (pagos PC/PP hechos a mano o por la flota de impuestos, sin trabajo en la mesa: el caso benigno del nivel amarillo). Primer día del reloj: 2026-08-20. |
| 7 | Lista de tipos en UN lugar | **✅ tabla** / ⏳ consumidores | `qualia_tipos_registrables` creada y sembrada (7 tipos, orden de encendido F4). El case de `poller.sh:305-340` y `ENDPOINTS` de qualia-lapidas coinciden hoy con la tabla (verificado 2026-08-20); el comentario desactualizado de poller.sh:289 era el que mentía. **Falta**: que poller/lapidas/cuadre la LEAN (hoy el cuadre ya la lee; los otros dos siguen con su copia — se cambian con el port). |
| 8 | Catálogo de GUIDs por empresa | **✅ tabla** / ⏳ consumidores | `qualia_catalogo_adm` creada y sembrada con las 23 filas de Blackbox: tax schedules (3, de registrar-en-adm.py), tipos de gasto 606 (11, leídos de /api/ExpenseTypes el 2026-08-20), términos de pago (4), cuentas fuera de paginado (2), tarjetas-caja (2), default (1). **Falta**: `_shared/catalogo.ts` y que el registrador nazca leyéndola (el grep de las 6 constantes = 0 se verifica sobre el registrador, que aún no existe). |
| 9 | Banco de cuadre en TS | **✅** | `_shared/cuadre.ts` (BigInt exacto, half-up ties-away-from-zero, descuento antes del redondeo). `deploy/generar-banco-cuadre.sh` regenera `cuadre-esperado.json` DESDE cuadre.py y corre `cuadre.test.ts`: los 63 casos reales de casos-cuadre.json comparados caso por caso contra la salida del Python — totales antes/después, precios finales, renglón/valores del ajuste. 2/2 suites verdes 2026-08-20 (incluye las trampas: 60.255→60.26, 749.9768→749.98, 316.635→316.64 con descuento, 637.20 de FP00001122). |
| 12 | CHECK de evidencia extendido | **✅** | Migración `20260820162758_f4_precondiciones_tablas.sql`: el CHECK del 2026-08-03 (sólo docid not null) se reemplazó por docid NO VACÍO + `pendiente_autorizacion` false. 0 filas violaban sobre 389 al aplicar. `pg_get_constraintdef` verificado contra la base viva. |

## Abiertas (sin arrancar o bloqueadas)

| # | Precondición | Próximo paso |
|---|---|---|
| 1b | Sondas §1.3 con rol único | correrlas y pegar la salida arriba |
| 3 | Flota admcloud-* auditada (caller→empresa) | auditoría de las 10 functions con service_role; `anular-registro` no puede seguir aceptando la anon |
| 4 | Credenciales a Vault | partir `admcloud_empresas`; `select('*')` = 0 sobre credenciales |
| 6 | Turno por empresa + claim | diseño §4 (RPC transaccional), va con el registrador |
| 10 | Matriz Reference por recurso | exige UN POST real por recurso — coordinar con Carlos (escrituras de prueba en producción) |
| 11 | Rol de base propio sin service_role | migración de rol + llave restringida para el registrador |
| 13 | Un solo mutex con el poller | cambio en poller.sh en el MISMO commit que encienda F4.2 |
| 14 | Presupuesto de tiempo por tipo | medir p95 sobre el backtest F4.1 |
| 15 | Lápidas: `indeterminado` sobre recurso derivado | caso de prueba NCP00000006 |
| 16 | Estado `parcial` + aviso | va con `qualia_escrituras` (ledger §4.4) |
| 17 | Barrera de nómina por cuentas+monto | caso obligatorio del backtest F4.1 |
| 18 | Adopción de tres llaves | test contra el histórico en el backtest F4.1 |
