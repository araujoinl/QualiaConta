-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- Blindaje de las tablas de infra F1: nada de acceso público (además del RLS
-- sin policies, se revocan los grants por si el proyecto los otorga por
-- default), y el bearer de los crons/triggers nace y vive DENTRO de la base
-- (qualia_config), nunca en un log ni en un archivo. Las functions lo validan
-- leyéndolo con su service client (docs/plan-salida-hermes.md §4.6).

revoke all on public.qualia_config, public.qualia_llm_uso, public.qualia_sombra
  from anon, authenticated;

insert into public.qualia_config (empresa_id, clave, valor, actualizado_por)
values (null, 'cron_bearer',
        jsonb_build_object('bearer', encode(gen_random_bytes(24), 'hex')),
        'migracion 20260816000200')
on conflict (empresa_id, clave) do nothing;
