-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- Infraestructura F1 de la salida de Hermes (docs/plan-salida-hermes.md §4.2 y §5-F1).
-- Tres tablas de soporte del pipeline serverless. RLS habilitada SIN policies:
-- solo las Edge Functions (service role) las tocan; la web no las necesita.

create table public.qualia_config (
  id bigint generated always as identity primary key,
  empresa_id uuid references public.admcloud_empresas(id) on delete cascade,
  clave text not null,
  valor jsonb not null,
  actualizado_en timestamptz not null default now(),
  actualizado_por text,
  unique nulls not distinct (empresa_id, clave)
);
comment on table public.qualia_config is
  'Flags y parámetros del pipeline serverless de QualiaConta; empresa_id null = global. clave "modo": server|sombra|nube (ausencia = server).';
alter table public.qualia_config enable row level security;

create table public.qualia_llm_uso (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  empresa_id uuid,
  funcion text not null,
  proposito text,
  modelo text,
  proveedor text,
  tokens_entrada integer,
  tokens_salida integer,
  tokens_razonamiento integer,
  latencia_ms integer,
  estado text not null default 'en_vuelo',
  codigo_error text,
  continuacion boolean not null default false
);
comment on table public.qualia_llm_uso is
  'Una fila por llamada al LLM desde las functions: freno de cuota (tokens de ENTRADA por ventana de 5h), gate de concurrencia (estado en_vuelo) y métricas. Reemplaza a registrar-consumo.py y medir-turnos.py.';
create index qualia_llm_uso_ts_idx on public.qualia_llm_uso (ts desc);
create index qualia_llm_uso_en_vuelo_idx on public.qualia_llm_uso (ts) where estado = 'en_vuelo';
alter table public.qualia_llm_uso enable row level security;

create table public.qualia_sombra (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  funcion text not null,
  empresa_id uuid,
  clave text not null,
  payload jsonb
);
comment on table public.qualia_sombra is
  'Modo sombra de la mudanza (F1/F2): lo que cada function HARÍA sin tocar producción, para diffear contra lo que produce el server antes del cutover.';
create index qualia_sombra_fn_clave_idx on public.qualia_sombra (funcion, clave);
alter table public.qualia_sombra enable row level security;

-- El service role de las functions necesita las tablas y las secuencias identity.
grant select, insert, update, delete
  on public.qualia_config, public.qualia_llm_uso, public.qualia_sombra
  to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Modo global explícito: server (el default duro del código también es server;
-- esta fila lo hace visible y auditable).
insert into public.qualia_config (empresa_id, clave, valor, actualizado_por)
values (null, 'modo', '{"modo": "server"}', 'migracion 20260816000100');
