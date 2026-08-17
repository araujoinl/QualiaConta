-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- El padrón de RNC de la DGII, local.
--
-- Por qué: de los ~32s que tarda leer una factura, unos 5 se iban en preguntarle
-- al formulario web de la DGII "¿de quién es este RNC?" — un ASP.NET viejo que
-- obliga a dos viajes y a veces no responde. La DGII publica el padrón COMPLETO
-- como archivo (DGII_RNC.zip, 22,8 MB, ~1M de contribuyentes, actualizado cada
-- pocos días), así que esa pregunta se puede contestar desde acá en
-- milisegundos y sin depender de que su web esté de buenas.
--
-- Lo que NO se puede cachear, y por eso sigue online: la validez del
-- COMPROBANTE (NCF/e-CF). Eso es por documento y la DGII no lo publica en
-- bloque — cada factura se sigue verificando contra su servicio.
--
-- El campo `estado` es el que importa: ACTIVO vs SUSPENDIDO decide si el gasto
-- es admitido. `regimen` distingue al régimen especial (RST), que cambia
-- retenciones.

create table public.dgii_rnc (
  rnc text primary key,
  nombre text,
  nombre_comercial text,
  actividad text,
  estado text,
  regimen text,
  actualizado_en timestamptz not null default now()
);

comment on table public.dgii_rnc is
  'Padrón de contribuyentes de la DGII, cargado del archivo público DGII_RNC.zip. Responde "¿de quién es este RNC y está activo?" sin salir a su web. La validez del COMPROBANTE no vive acá: eso es por documento y sigue online.';

create index dgii_rnc_nombre_idx on public.dgii_rnc using gin (to_tsvector('spanish', coalesce(nombre, '')));

alter table public.dgii_rnc enable row level security;
revoke all on public.dgii_rnc from anon, authenticated;
grant select, insert, update, delete on public.dgii_rnc to service_role;

-- Marca de frescura del padrón, para que qualia-salud avise si deja de
-- cargarse (un padrón viejo no falla: contesta con datos de hace meses, que es
-- la peor clase de error).
insert into public.qualia_config (empresa_id, clave, valor, actualizado_por)
values (null, 'refresco_padron_dgii', jsonb_build_object('en', null),
        'migracion 20260817000400')
on conflict (empresa_id, clave) do nothing;
