-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- Cron de las lápidas serverless (cierre de F1, docs/plan-salida-hermes.md
-- §5-F1): qualia-lapidas en sombra, cada hora a los :10 — ANTES del cron del
-- server (35 * * * *), para que la sombra registre su lápida primero y el
-- diff no muestre "lápida del server sin contraparte" por puro timing.

select cron.schedule('qualia-lapidas', '10 * * * *', $$select public.qualia_disparar('qualia-lapidas')$$);
