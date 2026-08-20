-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- F4 §4: la base del registrador de la nube — el ledger de escrituras (§4.4),
-- el turno por empresa (§4.2) y el claim de registro en la fila (§4.2 nivel 2).
-- ADM asigna el correlativo AL GUARDAR y dos POST simultáneos de la misma
-- empresa chocan (🪦 CB00000225): el flock del poller no existe entre
-- invocaciones de Edge Functions, así que acá es un LEASE que expira solo.

-- ── El ledger del escritor (no es contabilidad paralela: guarda INTENTOS) ───
create table if not exists qualia_escrituras (
  id bigint generated always as identity primary key,
  empresa_id uuid not null,
  trabajo_id uuid not null,
  invocacion text not null,
  recurso text not null,
  referencia text,
  ncf text,
  monto numeric,
  fecha_doc date,
  hash_payload text not null,
  estado text not null check (estado in ('iniciada','confirmada','parcial','fallida','frenada')),
  adm_uuid text,
  adm_docid text,
  referencia_persistida boolean,
  detalle text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table qualia_escrituras is
  'Una fila por INTENTO de escritura del registrador (F4 §4.4). De acá salen el tope diario, '
  'la caza de huérfanos del cuadre y «qué escribió el agente hoy». parcial = documento creado '
  'sin su Authorize (E6). Una iniciada sin cierre JAMÁS se re-dispara sola (E7).';

create index if not exists qualia_escrituras_empresa_dia
  on qualia_escrituras (empresa_id, creado_en desc);
create index if not exists qualia_escrituras_trabajo
  on qualia_escrituras (trabajo_id);

alter table qualia_escrituras enable row level security;

-- ── El turno por empresa (lease renovable; protege el correlativo de ADM) ───
create table if not exists qualia_registro_turno (
  empresa_id uuid primary key,
  dueno text not null,
  expira_en timestamptz not null
);

alter table qualia_registro_turno enable row level security;

-- Tomar el turno: el advisory lock protege lo único que es transacción corta
-- (decidir quién lo toma); el lease protege el resto. Un worker muerto lo
-- libera solo al vencer — lo que un flock de archivo no hace bien en la nube.
create or replace function qualia_tomar_turno(
  p_empresa uuid, p_invocacion text, p_ttl_s int default 330
) returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  tomado boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('qualia_registro:' || p_empresa::text));
  insert into qualia_registro_turno (empresa_id, dueno, expira_en)
  values (p_empresa, p_invocacion, now() + make_interval(secs => p_ttl_s))
  on conflict (empresa_id) do update
    set dueno = excluded.dueno, expira_en = excluded.expira_en
    where qualia_registro_turno.expira_en < now()
       or qualia_registro_turno.dueno = excluded.dueno;
  select exists(
    select 1 from qualia_registro_turno
    where empresa_id = p_empresa and dueno = p_invocacion and expira_en > now()
  ) into tomado;
  return tomado;
end;
$$;

create or replace function qualia_renovar_turno(
  p_empresa uuid, p_invocacion text, p_ttl_s int default 330
) returns boolean
language sql
security definer set search_path = public
as $$
  update qualia_registro_turno
     set expira_en = now() + make_interval(secs => p_ttl_s)
   where empresa_id = p_empresa and dueno = p_invocacion and expira_en > now()
   returning true;
$$;

create or replace function qualia_soltar_turno(p_empresa uuid, p_invocacion text)
returns void
language sql
security definer set search_path = public
as $$
  delete from qualia_registro_turno
   where empresa_id = p_empresa and dueno = p_invocacion;
$$;

-- ── El claim de registro en la fila + tope diario, en UNA transacción ───────
-- Columnas nuevas en qualia_trabajos: quién está registrando esta fila y hasta
-- cuándo le dura el claim. El TTL viene del caller POR TIPO (E7: el 330s
-- original era más corto que el peor caso medido de la propia invocación).
alter table qualia_trabajos
  add column if not exists registro_claim_por text,
  add column if not exists registro_claim_hasta timestamptz;

create or replace function qualia_claim_registro(
  p_trabajo uuid, p_invocacion text, p_ttl_s int, p_tope_diario int default 20
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_empresa uuid;
  v_hoy int;
  v_ok boolean;
begin
  select empresa_id into v_empresa from qualia_trabajos where id = p_trabajo;
  if v_empresa is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;

  -- El tope diario se cuenta DENTRO de la misma transacción del claim (§3.3):
  -- así dos invocaciones no pueden pasar las dos con el contador en 19.
  select count(*) into v_hoy
    from qualia_escrituras
   where empresa_id = v_empresa
     and creado_en >= date_trunc('day', now() at time zone 'America/Santo_Domingo')
                       at time zone 'America/Santo_Domingo'
     and estado in ('iniciada','confirmada','parcial');
  if v_hoy >= p_tope_diario then
    return jsonb_build_object('ok', false, 'motivo', 'tope_diario', 'hoy', v_hoy);
  end if;

  update qualia_trabajos
     set registro_claim_por = p_invocacion,
         registro_claim_hasta = now() + make_interval(secs => p_ttl_s)
   where id = p_trabajo
     and estado = 'aprobada'
     and (registro_claim_hasta is null or registro_claim_hasta < now()
          or registro_claim_por = p_invocacion)
   returning true into v_ok;

  if v_ok is null then
    return jsonb_build_object('ok', false, 'motivo', 'sin_claim');
  end if;
  return jsonb_build_object('ok', true, 'empresa_id', v_empresa);
end;
$$;

-- Sólo el service (functions) llama estas RPC; nada para anon/authenticated.
revoke execute on function qualia_tomar_turno(uuid, text, int) from public, anon, authenticated;
revoke execute on function qualia_renovar_turno(uuid, text, int) from public, anon, authenticated;
revoke execute on function qualia_soltar_turno(uuid, text) from public, anon, authenticated;
revoke execute on function qualia_claim_registro(uuid, text, int, int) from public, anon, authenticated;
