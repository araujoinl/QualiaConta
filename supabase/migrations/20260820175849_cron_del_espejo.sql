-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- El espejo de facturas pasa a la nube (qualia-espejo): su alimentador vivía
-- en el cron del server (mesa/refrescar-recurrentes.sh, cada hora) y murió con
-- CodeBox el 2026-08-20. Sin refresco, el detector de recurrentes lee un
-- espejo congelado y dice «todavía no facturó» horas después de que la
-- factura entró. Cada hora a los :05, antes que el cron de conciliación.

select cron.schedule('qualia-espejo', '5 * * * *',
  $$select public.qualia_disparar('qualia-espejo')$$);
