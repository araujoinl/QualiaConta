-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- Se retira el índice de texto completo sobre `nombre`.
--
-- Por qué: la carga del padrón (1M de filas por lotes) moría con «canceling
-- statement due to statement timeout» — recalcular el tsvector de cada lote es
-- la parte cara del upsert, y ese índice no lo usa nadie: la única pregunta
-- que el preparador le hace a esta tabla es por RNC, que ya es la llave
-- primaria. Un índice que nadie consulta y que impide cargar los datos es
-- costo puro.
--
-- Si algún día hace falta buscar por nombre, se crea con CONCURRENTLY después
-- de la carga, no antes.

drop index if exists public.dgii_rnc_nombre_idx;
