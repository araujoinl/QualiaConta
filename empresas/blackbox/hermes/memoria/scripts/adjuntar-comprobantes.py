#!/usr/bin/env python3
"""Adjunta el comprobante fiscal a los cargos bancarios que ya estan en ADM.

Dos usos: el backfill de todo lo que se registro sin soporte antes de que el
registro supiera adjuntar, y la red para lo que falle despues — si el PDF del
comprobante todavia no estaba partido cuando se registro el cargo, aca se
recupera sin tocar el documento de ADM.

Es idempotente por `registro_adm.adjunto`: lo que ya tiene marca no se vuelve a
subir. Solo mira documentos VIVOS: sobre un anulado no hay nada que soportar.

Reusa `subir_adjunto` de registrar-cargo-bancario.py en vez de copiarla — ese
script define todo bajo funciones y su main() esta detras de `__main__`, asi que
importarlo no dispara nada.
"""

import importlib.util
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "registrar_cargo_bancario", os.path.join(AQUI, "registrar-cargo-bancario.py")
)
reg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(reg)

CONSULTA = """
select id,
       propuesta->>'ncf',
       propuesta->>'banco',
       propuesta->'registro_adm'->>'uuid',
       propuesta->'registro_adm'->>'docid'
  from qualia_trabajos
 where empresa_id = :'emp'
   and propuesta->>'documento_adm' = 'BankCharges'
   and coalesce(propuesta->>'ncf', '') <> ''
   and coalesce(propuesta->'registro_adm'->>'uuid', '') <> ''
   and coalesce(propuesta->'registro_adm'->>'anulado_en', '') = ''
   and coalesce(propuesta->'registro_adm'->>'eliminado_en', '') = ''
   and propuesta->'registro_adm'->>'adjunto' is null
 order by propuesta->'registro_adm'->>'docid';
"""


def main():
    empresa = reg.env("QUALIA_EMPRESA_ID")
    filas = reg.sql(CONSULTA, emp=empresa)
    print("cargos vivos sin adjunto: %d" % len(filas))

    subidos = sin_pdf = fallados = 0
    for fila in filas:
        if len(fila) < 5:
            continue
        trabajo_id, ncf, banco, guid, docid = fila[0], fila[1], fila[2], fila[3], fila[4]
        ruta = "/comprobantes/%s/%s.pdf" % (banco, ncf)
        if not os.path.exists(ruta):
            print("  %s (%s): sin PDF todavia" % (docid, ncf))
            sin_pdf += 1
            continue
        try:
            reg.subir_adjunto(guid, ruta)
            reg.sql(
                "update qualia_trabajos set propuesta = jsonb_set(propuesta, "
                "'{registro_adm,adjunto}', to_jsonb(:'n'::text)) "
                "where id = :'id' and empresa_id = :'emp';",
                n="%s.pdf" % ncf, id=trabajo_id, emp=empresa,
            )
            print("  %s (%s): adjuntado" % (docid, ncf))
            subidos += 1
        except Exception as e:  # noqa: BLE001 — un fallo no puede cortar el resto
            print("  %s (%s): FALLO %s" % (docid, ncf, e))
            fallados += 1

    print("\nadjuntados %d · sin PDF %d · fallados %d" % (subidos, sin_pdf, fallados))
    return 1 if fallados else 0


if __name__ == "__main__":
    sys.exit(main())
