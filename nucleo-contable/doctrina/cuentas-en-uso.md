---
estado: borrador
aprobo:
evidencia: destilado determinista del agg (1118 facturas históricas de ADM), regenerado 2026-08-07
---

# Cuentas en uso — semántica y evidencia

Las cuentas que la contabilidad REAL de la empresa usa, con su evidencia. La
última columna es la doctrina: **qué es esta cuenta y qué NO va acá** — la
dicta Carlos y este generador la preserva entre corridas. Una cuenta sin
dictado se usa solo por precedente del agg (arranque), nunca para razonar un
caso nuevo.

Dos aprendizajes de la auditoría 2026-08-07 esperan su fila (dictarlos acá al
ratificar): capitalizables NO van a cuentas de gasto (el inversor de Suena →
activo, P-004) y la membresía de fitness es representación.

Regenerar (la evidencia; la semántica dictada sobrevive):

    python3 nucleo-contable/scripts/generar-cuentas-en-uso.py

| Cuenta | Nombre | Tipo (plan) | Usos | Provs | Proveedores típicos | Qué es / qué NO va acá |
|---|---|---|---|---|---|---|
| `102.01` | Banco Suplidores USD 404 | Activo | 7 | 1 | Banco Multiple Santa Cru | — (dictar en ratificación) |
| `130.02` | Compras en Tránsito | Activo | 69 | 12 | Logistichause Internatio, DGA ADUANAS, M C Logistics Srl | Compras en tránsito: importaciones en curso (facturas grandes sin ITBIS de courier/naviera que acompañan una importación) |
| `150.01` | Seguros | Activo | 3 | 2 | Banco Multiple Santa Cru, Seguros Sura S A | — (dictar en ratificación) |
| `150.04` | ITBIS Adelantado | Activo | 10 | 1 | DGA ADUANAS | — (dictar en ratificación) |
| `160.03` | Edificaciones / Naves industriales | Activo | 1 | 1 | Banco Multiple Santa Cru | — (dictar en ratificación) |
| `160.06` | Mobiliarios y Equipos de Oficina | Activo | 11 | 8 | Cecomsa Srl, Sarton Dominicana Sas, Conformatic Srl | — (dictar en ratificación) |
| `160.07` | Otros Activos Fijos | Activo | 8 | 6 | Suena Electronica Srl, Refricentro Rubiera Srl, Electromuebles Kewrys Sr | — (dictar en ratificación) |
| `210.01` | Itbis Operativo | Pasivo | 3 | 3 | Banco Multiple Santa Cru, Megasuply Srl, DGA ADUANAS | — (dictar en ratificación) |
| `230.01` | Préstamo Hipotecario (San Gerónimo) | Pasivo | 1 | 1 | Banco Multiple Santa Cru | — (dictar en ratificación) |
| `230.02` | Prestamo Y No. 00003 | Pasivo | 3 | 1 | Banco Multiple Santa Cru | — (dictar en ratificación) |
| `230.03` | Leasing 247355SDO071A | Pasivo | 18 | 1 | Banco Multiple Santa Cru | — (dictar en ratificación) |
| `305` | Carga Inicial | Capital | 5 | 2 | Acomsa, LBY | — (dictar en ratificación) |
| `511.04` | Fletes | Costo | 4 | 1 | Logistichause Internatio | — (dictar en ratificación) |
| `611.02` | Comisiones | Gasto | 1 | 1 | FREEWAY ENTERPRISE SRL | — (dictar en ratificación) |
| `611.12` | Uniformes | Gasto | 4 | 1 | Valeco Print Solutions S | — (dictar en ratificación) |
| `611.13` | Capacitación | Gasto | 2 | 2 | Edufinsa Escuela De Nego, Centro De Capacitacion E | — (dictar en ratificación) |
| `611.14` | Otros gastos de personal | Gasto | 6 | 6 | Good Market Express Eg S, Bravo S A, The Money Coach | — (dictar en ratificación) |
| `611.16` | Transporte y otros | Gasto | 1 | 1 | Pier 17 Group Dominicana | — (dictar en ratificación) |
| `611.17` | Dieta y Viáticos | Gasto | 81 | 45 | Inversiones Max Grill Sr, Grupo Rolling Srl, Sabores Del Desierto Srl | — (dictar en ratificación) |
| `611.18` | Seguro Medico | Gasto | 19 | 1 | Humano Seguros S A | — (dictar en ratificación) |
| `611.19` | Dieta y Viáticos (Bien) | Gasto | 1 | 1 | Inversiones Aika Srl | — (dictar en ratificación) |
| `620.03` | Mantenimientos generales | Gasto | 14 | 7 | Almacenes Unidos Sas, Oliver Exterminating Dom, Grupo Arqlux Srl | — (dictar en ratificación) |
| `620.05` | Comunicación | Gasto | 22 | 1 | Compania Dominicana De T | — (dictar en ratificación) |
| `620.06` | Suministros de oficina y otros | Gasto | 88 | 24 | Supermercado El Dragon D, Megasuply Srl, Almacenes Unidos Sas | — (dictar en ratificación) |
| `620.07` | Servicios de Limpieza | Gasto | 1 | 1 | THE BIG APPLE CLEANERS S | — (dictar en ratificación) |
| `620.09` | Gasto de Impuesto Selectivo al consumo | Gasto | 23 | 3 | Compania Dominicana De T, Humano Seguros S A, Seguros Sura S A | — (dictar en ratificación) |
| `620.10` | Envios y Correspondencias | Gasto | 132 | 2 | Tupaq Cargo & Courier Sr, Moon & Sea Logistics Srl | Flete/courier COMPLETO: el fuel surcharge, manejo y tasas del envío van ACÁ con el servicio, no a 620.11 (backtest 2026-08-07, criterio ratificado) |
| `620.11` | Combustible | Gasto | 370 | 44 | Isla Dominicana De Petro, Mecari Srl, Estacion De Servicios H  | Combustible de FLOTILLA en bomba, sin ITBIS discriminado (va en el precio). NO recargos de combustible de couriers ni fletes |
| `620.12` | Gastos de Software | Gasto | 4 | 1 | Fortech Srl | — (dictar en ratificación) |
| `621.01` | Servicios Contables | Gasto | 23 | 2 | Account One Dcm2rp, Srl, Fortech Srl | — (dictar en ratificación) |
| `621.02` | Servcios Legales | Gasto | 1 | 1 | Ingenieria Del Valor Srl | — (dictar en ratificación) |
| `621.03` | Servicios Tecnicos | Gasto | 1 | 1 | Puntomac Srl | — (dictar en ratificación) |
| `621.04` | Otros servicios profesionales | Gasto | 3 | 1 | Emprendia Consulting Srl | — (dictar en ratificación) |
| `630.03` | Publicidad Medios Tradicionales | Gasto | 1 | 1 | Likecorp Srl. | — (dictar en ratificación) |
| `630.05` | Gastos de Representación | Gasto | 8 | 8 | Bona S A, Bakerstreet Holdings Srl, Body Shop Athletic Club  | — (dictar en ratificación) |
| `630.06` | Manejo de Redes Sociales | Gasto | 6 | 1 | Apr Creators Srl | — (dictar en ratificación) |
| `640.01` | Cargos Bancarios | Gasto | 35 | 1 | Banco Multiple Santa Cru | Comisiones y cargos del banco (transferencias, LBTR). Deducible, sin crédito fiscal salvo NCF del banco |
| `640.02` | Cargos sobre cheques 0.15 | Gasto | 136 | 1 | Banco Multiple Santa Cru | Impuesto sobre transacciones (2×1000 Ley 30-26; el «0.15» del nombre es herencia del 1.5‰). Jamás crédito fiscal |
| `650.05` | Amortización de Bienes intangibles (Pr | Gasto | 1 | 1 | Humano Seguros S A | — (dictar en ratificación) |
| `650.06` | Reparaciones y Mantenimientos Activos  | Gasto | 1 | 1 | Grupo Arqlux Srl | — (dictar en ratificación) |
| `650.08` | Reparaciones y Mantenimientos Equipos  | Gasto | 9 | 5 | Premier Wash Technology , Estacion De Servicios H , Talleres Benjamin Egli S | — (dictar en ratificación) |
| `650.09` | Reparaciones y Mantenimientos de Mobil | Gasto | 6 | 2 | Suena Electronica Srl, Anarca Investments Srl | — (dictar en ratificación) |
| `660.01` | Seguros de Vehículos | Gasto | 17 | 2 | Banco Multiple Santa Cru, Humano Seguros S A | — (dictar en ratificación) |
| `690.05` | Otros Impuestos | Gasto | 20 | 1 | Compania Dominicana De T | — (dictar en ratificación) |
| `690.06` | Propina Legal | Gasto | 59 | 32 | Inversiones Max Grill Sr, Grupo Rolling Srl, Jade Teriyaki Srl | — (dictar en ratificación) |
| `801.01` | Gastos sin comprobante de crédito fisc | Gastos No Operacionales | 15 | 11 | Tupaq Cargo & Courier Sr, Isla Dominicana De Petro, Mecari Srl | — (dictar en ratificación) |
| `801.02` | Gastos personales no deduccibles | Gastos No Operacionales | 1 | 1 | Laboratorios Dr Collado  | — (dictar en ratificación) |
| `802.01` | Intereses de Préstamos | Gastos No Operacionales | 10 | 1 | Banco Multiple Santa Cru | — (dictar en ratificación) |
