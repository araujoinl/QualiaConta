-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- F4 precondición 5: el cron de cuadre 1:1 (plan-f4-registrador.md §7). Es el
-- detector de todos los modos de fallo de escritura y su criterio de cierre es
-- 14 días corridos EN VERDE sobre la escritura del server, ANTES del primer
-- POST del registrador de la nube. La corrida de hoy enciende ese reloj.

create table if not exists qualia_cuadre_corridas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null,
  corrida_en timestamptz not null default now(),
  ventana_desde date,
  ventana_hasta date,
  verde boolean not null,
  hallazgos jsonb not null default '[]'::jsonb,
  resumen text
);

comment on table qualia_cuadre_corridas is
  'Una fila por corrida del cron qualia-cuadre (F4 §7). verde=false con cualquier hallazgo rojo: '
  'huérfano con llave nuestra, descuadre de monto, nómina autónoma, deriva de la API o corrida rota. '
  'El reloj de 14 días de la precondición 5 se cuenta sobre esta tabla.';

create index if not exists qualia_cuadre_corridas_empresa_fecha
  on qualia_cuadre_corridas (empresa_id, corrida_en desc);

alter table qualia_cuadre_corridas enable row level security;
-- Sin policies: la escriben las functions (service_role) y se consulta por acá.

-- Diario a las 03:50 UTC = 23:50 de República Dominicana: el barrido cierra el
-- día completo de escritura del server antes de la medianoche local.
select cron.schedule('qualia-cuadre', '50 3 * * *',
  $$select public.qualia_disparar('qualia-cuadre')$$);
