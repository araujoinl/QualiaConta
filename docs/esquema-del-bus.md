# El esquema del bus — qué hay que crear en Postgres

Este repo trae al contable, pero **no trae la base donde trabaja**. Las tablas
`qualia_*` viven como migraciones en el repo de la aplicación web (Labs_Inv,
`frontend/supabase/migrations/`), porque es esa app la que las usa desde el
navegador. Quien monte QualiaConta contra una base nueva tiene que crearlas.

Este documento es el inventario exacto de lo que hace falta, medido contra la
base viva el 2026-08-03, no reconstruido de memoria. El contrato de uso —qué
significa cada estado, quién mueve qué— está en [mesa-de-trabajo.md](mesa-de-trabajo.md);
acá está solo la forma.

## Lo que hay que crear, de un vistazo

| # | Migración | Qué trae |
|---|---|---|
| 1 | `bus_rol_contable` | El rol de conexión del contable |
| 2 | `bus_mesa_trabajo` | `qualia_trabajos`, `qualia_eventos`, `qualia_libro` + trigger + RLS |
| 3 | `bus_grants_contable` | Grants y policies del rol sobre las tres |
| 4 | `bus_update_por_columna` | Recorta el UPDATE del contable a cuatro columnas |
| 5 | `bus_registrada_con_evidencia` | CHECK: no hay `registrada` sin DocID |
| 6 | `bus_actualizaciones` | `qualia_actualizaciones` (bitácora de corridas) + grants |
| 7 | `bus_servicio` | `qualia_servicio` (cuota del LLM) + grants |
| 8 | `bus_storage` | Bucket privado de documentos + policies |

Dependen entre sí en ese orden. Las 2 y 3 pueden ir juntas; se separan acá
porque así nacieron y porque los grants son lo que más se olvida.

Dos dependencias que este repo **no** define y hay que resolver antes:

- **`admcloud_empresas(id uuid)`** — la tabla de empresas. Tres FKs apuntan ahí.
- **`usuarios(id uuid)`** — los usuarios de la web. Tres FKs apuntan ahí.

Si tu instalación no las tiene, la salida honesta es quitar esas FKs y dejar los
`uuid` sueltos: el contable nunca las usa para hacer joins, solo filtra por
`empresa_id`.

---

## 1. El rol del contable

El contable **no entra con las llaves de Supabase**. Se conecta por DSN directo
con un rol propio de permisos mínimos. Es lo que permite que un agente LLM con
terminal viva en otra máquina sin poder tocar el resto de la base.

```sql
create role qualiaconta_lector login password '<poné una fuerte>';
grant usage on schema public to qualiaconta_lector;
```

Ese usuario y contraseña son los que van en `QUALIA_DSN` del contenedor.

> **No es owner de ninguna tabla.** En Postgres los derechos efectivos son
> `grants ∩ policies`: necesita las dos cosas, siempre. Olvidar la policy es el
> error que más veces se repitió acá, y falla con «permission denied» recién en
> tiempo de corrida.

## 2. La mesa de trabajo

Tres tablas. `qualia_trabajos` es la cola, `qualia_eventos` el hilo de
conversación, `qualia_libro` el espejo del libro de acción (el canónico son los
archivos markdown de este repo; la tabla existe para que la web lo muestre).

```sql
create table public.qualia_trabajos (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references admcloud_empresas(id) on delete cascade,
  tipo                text not null default 'factura',
  origen              text not null default 'web',
  estado              text not null default 'pendiente',
  archivo_path        text,
  archivo_nombre      text,
  archivo_url         text,
  resumen             text,
  propuesta           jsonb,
  creado_por          uuid references usuarios(id) on delete set null,
  aprobado_por        uuid references usuarios(id) on delete set null,
  aprobado_por_nombre text,
  error_detalle       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint qualia_trabajos_estado_check check (estado in (
    'pendiente','analizando','esperando_respuesta','propuesta',
    'aprobada','rechazada','registrada','error'))
);

create index idx_qualia_trabajos_empresa_estado on qualia_trabajos (empresa_id, estado);
create index idx_qualia_trabajos_empresa_creado on qualia_trabajos (empresa_id, created_at desc);
```

Notas que no se ven en el DDL:

- **`tipo` y `origen` no tienen CHECK a propósito.** Hoy circulan `factura`,
  `sugerencia` y `criterio`. Una lista fija obliga a una migración por cada
  clase nueva y rompe contra las filas viejas; que la tabla sea el catálogo
  sale más barato.
- **`aprobado_por_nombre` está denormalizado a propósito**: el «quién aprobó»
  del libro tiene que sobrevivir aunque se borre el usuario.
- **`propuesta` es el contrato real entre el contable y la web.** Su forma está
  en [mesa-de-trabajo.md](mesa-de-trabajo.md). Lo que la base sí exige está en
  la migración 5.

```sql
create table public.qualia_eventos (
  id         bigint generated always as identity primary key,
  trabajo_id uuid not null references qualia_trabajos(id) on delete cascade,
  autor      text not null,               -- 'usuario' | 'contable'
  tipo       text not null,               -- progreso | nota | pregunta | respuesta
  contenido  text,
  datos      jsonb,
  creado_por uuid references usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_qualia_eventos_trabajo on qualia_eventos (trabajo_id, id);
```

> El índice es sobre `(trabajo_id, id)` y no sobre `created_at`: **el poller
> avanza por `id`**, que es monótono, y dos eventos del mismo segundo no pueden
> quedar en orden ambiguo. Todo evento con `autor='usuario'` es la señal que lo
> despierta.

```sql
create table public.qualia_libro (
  id                  bigint generated always as identity primary key,
  empresa_id          uuid not null references admcloud_empresas(id) on delete cascade,
  trabajo_id          uuid references qualia_trabajos(id) on delete set null,
  entrada             text not null,
  metodo              text,
  precedente_ref      text,
  aprobado_por_nombre text,
  ref_git             text,
  created_at          timestamptz not null default now()
);

create index idx_qualia_libro_empresa_creado on qualia_libro (empresa_id, created_at desc);
```

`trabajo_id` es `on delete set null` y no `cascade`: borrar una factura de la
mesa **no** puede borrar su entrada del libro. El libro es append-only.

### El trigger de `updated_at`

```sql
create or replace function public.qualia_trabajos_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_qualia_trabajos_updated_at
  before update on public.qualia_trabajos
  for each row execute function qualia_trabajos_set_updated_at();
```

Existe para que nadie tenga que acordarse — y porque el contable **no tiene
permiso** para escribir esa columna (ver migración 4).

### RLS

Las tres van con RLS encendido y la web (`authenticated`) con acceso total. El
control fino de quién ve qué lo hace la app, no la base.

```sql
alter table qualia_trabajos enable row level security;
alter table qualia_eventos  enable row level security;
alter table qualia_libro    enable row level security;

create policy qualia_trabajos_authenticated_all on qualia_trabajos
  for all to authenticated using (true) with check (true);
create policy qualia_eventos_authenticated_all on qualia_eventos
  for all to authenticated using (true) with check (true);
create policy qualia_libro_select_authenticated on qualia_libro
  for select to authenticated using (true);
```

> Esta RLS es **tautológica** y está anotada como deuda. Endurecerla por
> `empresa_id` está pendiente; si montás esto con datos de más de una empresa y
> usuarios que no deban cruzarse, hacelo antes de arrancar.

## 3. Grants y policies del contable

```sql
grant select, insert, update on qualia_trabajos to qualiaconta_lector;
grant select, insert          on qualia_eventos  to qualiaconta_lector;
grant select, insert          on qualia_libro    to qualiaconta_lector;

create policy qualia_trabajos_worker on qualia_trabajos
  for all to qualiaconta_lector using (true) with check (true);
create policy qualia_eventos_worker on qualia_eventos
  for all to qualiaconta_lector using (true) with check (true);
create policy qualia_libro_worker on qualia_libro
  for all to qualiaconta_lector using (true) with check (true);
```

El contable **no puede borrar nada, en ninguna de las tres**. Y en eventos y
libro tampoco puede actualizar: son append-only por diseño.

## 4. El UPDATE recortado por columna

```sql
revoke update on qualia_trabajos from qualiaconta_lector;
grant  update (estado, resumen, propuesta, error_detalle)
  on qualia_trabajos to qualiaconta_lector;
```

Cuatro columnas y ninguna más. El contable no puede reescribir `archivo_url`,
ni `empresa_id`, ni la autoría de la aprobación.

> **La trampa que esto tiende.** Un `update ... set estado='registrada',
> updated_at=now()` **muere entero** con «permission denied for table
> qualia_trabajos», no parcialmente. El reflejo de sellar `updated_at` a mano es
> exactamente lo que rompe. No hace falta: el trigger ya lo hace.

## 5. No hay `registrada` sin evidencia

```sql
alter table qualia_trabajos
  add constraint qualia_trabajos_registrada_con_evidencia
  check (estado <> 'registrada'
         or (propuesta -> 'registro_adm' ->> 'docid') is not null);
```

Una factura solo puede declararse registrada si trae el número del documento que
la generó en ADM. Se exige el `docid` y no la mera presencia de la llave: un
`registro_adm` vacío pasaría un `? 'registro_adm'` sin ser evidencia de nada.

El orden del contrato es **registrar primero y escribir después**: jamás un
estado ni una entrada de libro sin el documento que los generó.

## 6. Bitácora de corridas

Las tareas nocturnas (destilado de precedentes, respaldos) dejan acá su rastro.
Es append-only con upsert por corrida, así que re-correr una tarea la misma
noche actualiza su fila en vez de duplicarla.

```sql
create table public.qualia_actualizaciones (
  id         bigint generated always as identity primary key,
  empresa_id uuid not null references admcloud_empresas(id) on delete cascade,
  tarea      text not null,
  inicio     timestamptz not null,
  fin        timestamptz,
  ok         boolean,
  fallas     integer not null default 0,
  resumen    jsonb,
  detalle    text,
  created_at timestamptz not null default now(),
  constraint qualia_actualizaciones_corrida_unica unique (empresa_id, tarea, inicio)
);

create index idx_qualia_actualizaciones_empresa_inicio
  on qualia_actualizaciones (empresa_id, inicio desc);

alter table qualia_actualizaciones enable row level security;
create policy qualia_actualizaciones_select_authenticated on qualia_actualizaciones
  for select to authenticated using (true);
create policy qualia_actualizaciones_worker on qualia_actualizaciones
  for all to qualiaconta_lector using (true) with check (true);

grant select, insert, update on qualia_actualizaciones to qualiaconta_lector;
```

`resumen` va en jsonb pero `detalle` guarda el log crudo entero: si el formato
del resumen cambia, el detalle sigue completo y solo se pierde la línea bonita.

## 7. Estado del servicio (cuota del LLM)

Una fila por empresa. Hoy dice una sola cosa: hasta cuándo está agotada la cuota
del proveedor de LLM.

```sql
create table public.qualia_servicio (
  empresa_id            uuid primary key,
  cuota_bloqueada_hasta timestamptz,
  cuota_detalle         text,
  actualizado_en        timestamptz not null default now()
);

alter table qualia_servicio enable row level security;
create policy qualia_servicio_lectura_web on qualia_servicio
  for select to authenticated using (true);
create policy qualia_servicio_worker on qualia_servicio
  for all to qualiaconta_lector using (true) with check (true);

grant select                 on qualia_servicio to authenticated;
grant select, insert, update on qualia_servicio to qualiaconta_lector;
```

Dos decisiones que conviene respetar si la reimplementás:

- **Guarda una HORA, no un booleano.** Un bloqueo vencido se lee como libre
  solo, comparando contra `now()`. Nadie tiene que ir a apagarlo, y si el poller
  muere a mitad de un corte el aviso caduca igual en vez de quedar pegado.
- **La web solo lee.** El estado lo escribe quien lo mide, que es el poller
  (`mesa/poller.sh`, sondeando al proveedor con un request de 1 token).

## 8. Storage de documentos

Bucket **privado**. El contable no tiene llaves de Supabase: descarga por una
URL firmada que la web guarda en `qualia_trabajos.archivo_url`.

```sql
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('qualia-conta', 'qualia-conta', false, array[
  'application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/heic', 'image/heif', 'application/xml', 'text/xml',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);
```

`heic`/`heif` están porque las fotos de iPhone llegan así; el preparador las
convierte a jpg. Los dos de Excel, porque las nóminas entran como planilla.

Y el borrado, que no es un `for delete` cualquiera:

```sql
create policy qualia_conta_delete_authenticated
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'qualia-conta'
    and not exists (
      select 1 from public.qualia_trabajos t
       where t.archivo_path = storage.objects.name
         and t.estado in ('aprobada','registrada')
    )
  );
```

**Un documento que respalda una factura ya aprobada o registrada no se puede
borrar.** El comprobante es la evidencia del asiento; quitarlo deja la
contabilidad sin respaldo.

---

## Cómo verificar que quedó bien

Conectado **con el DSN del contable**, no como admin:

```sql
select current_user;                        -- qualiaconta_lector

-- Debe decir UPDATE 1, no permission denied ni violación de CHECK
begin;
update qualia_trabajos set estado = 'registrada'
 where id = '<una fila aprobada con registro_adm.docid>' and estado = 'aprobada';
rollback;

-- Debe FALLAR con qualia_trabajos_registrada_con_evidencia
begin;
update qualia_trabajos set estado = 'registrada'
 where id = '<una fila sin docid>';
rollback;

-- Debe fallar con permission denied: updated_at no está concedida
begin;
update qualia_trabajos set estado = 'analizando', updated_at = now()
 where id = '<cualquiera>';
rollback;
```

Si las tres se comportan así, el bus está bien montado. El `rollback` no es
opcional en ninguna.

## Lo que este documento no cubre

- **La aplicación web** (la mesa donde el humano arrastra y aprueba) vive en el
  otro repo. Sin ella hay cola pero no hay quién la use.
- **Hermes**, el agente. La imagen base `hermes-agent:local` que pide
  `deploy/Dockerfile` se construye desde fuera de este repo.
- **Los secretos y la configuración por empresa**: `deploy/env.example` lista
  las variables, y `mapa-cuentas.example.yaml` la forma del mapa de cuentas.
- **El histórico contable.** Los precedentes salen de destilar las facturas ya
  registradas en el ADM Cloud de cada empresa. Una instalación nueva arranca con
  la memoria en blanco: el motor funciona, pero no sabe todavía cómo clasifica
  esta empresa.
