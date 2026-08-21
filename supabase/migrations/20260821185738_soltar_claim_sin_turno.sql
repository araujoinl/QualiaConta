-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- El agujero del 2026-08-21 (cuota del préstamo #339547, «se quedó
-- enganchado»): aprobar 3 filas en tanda disparó 3 pokes del trigger
-- qualia_aprobada_registrar, o sea 3 registradores en paralelo. Cada uno
-- reclamó SU fila (qualia_claim_registro), pero el turno por empresa lo ganó
-- uno solo — y los dos perdedores se fueron con salir('sin_turno') SIN soltar
-- el claim de su fila. Resultado: dos trabajos aprobados presos 360s (el TTL),
-- invisibles hasta para el barrido, y el humano mirando una pantalla quieta.
--
-- Esta RPC es la mitad de la cura: soltar el claim propio al salir sin turno.
-- La otra mitad vive en el registrador (index.ts): el que SÍ tiene el turno
-- arrastra la cola completa de aprobadas en esa misma corrida, así la tanda
-- entera se registra de un tirón y los pokes de más no dejan huella.
--
-- Sólo suelta el claim PROPIO (registro_claim_por = p_invocacion): soltar el
-- de otro sería robarle la fila a una corrida viva.

create or replace function qualia_soltar_claim(p_trabajo uuid, p_invocacion text)
returns void
language sql
security definer set search_path = public
as $$
  update qualia_trabajos
     set registro_claim_por = null,
         registro_claim_hasta = null
   where id = p_trabajo
     and registro_claim_por = p_invocacion;
$$;

revoke execute on function qualia_soltar_claim(uuid, text) from public, anon, authenticated;
