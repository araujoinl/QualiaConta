#!/usr/bin/env python3
"""Backtest del asignador de pagos: ¿cuántos pagos históricos reconstruye bien?

Es el GATE del motor de asignación de la caja «Pagos sin asignar»: el banco
muestra que salió plata y nunca dice a quién, y este algoritmo intenta
responderlo cruzando contra las cuentas por pagar de ADM. Antes de escribir el
detector hay que saber si sirve, y este script da el número sin tocar nada.

Read-only sobre el espejo de ADM. Se corre así:

    docker exec -i qualiaconta-blackbox python3 - < backtest-asignacion.py

La verdad de terreno es `Documents[]` de cada bill-payment: las facturas exactas
que ese pago saldó. Se simula la historia en orden —marcando como consumidas las
que el pago REAL aplicó, no las que el algoritmo adivinó— y se compara.

RESULTADO 2026-08-04 sobre 729 pagos:
    acierto con candidato único   593  (81%)
    ambiguo → pide elegir          20  (en los 20 la real estaba listada)
    equivocados                     0
    sin exacta → va a suma corrida 116 (la corrida acierta 29)

Sin la regla de ambigüedad el motor se equivocaba en 7 pagos, TODOS de Isla
Dominicana y Mecari: los dos proveedores que facturan montos redondos y
repetidos (mediana RD$600), donde varias facturas distintas dan el mismo total.
Ésa es la razón de que el motor liste candidatos en vez de elegir, y de que la
web bloquee el aprobar mientras haya más de uno. Si algún día se saca esa regla,
este script vuelve a dar 7 pagos aplicados a la factura equivocada.
"""
import collections
import json

RAW = '/opt/data/preentrenamiento/raw/'
c2 = lambda x: round(float(x or 0), 2)


def cargar():
    facturas = {}
    for line in open(RAW + 'vendor-bills-detalle.jsonl'):
        d = json.loads(line)['data']
        if d.get('Void'):
            continue
        facturas[d['DocID']] = {'docid': d['DocID'], 'fecha': d['DocDate'][:10],
                                'prov': d.get('RelationshipID'), 'total': c2(d.get('TotalAmount'))}
    pagos = []
    for line in open(RAW + 'bill-payments-detalle.jsonl'):
        d = json.loads(line)['data']
        if d.get('Void'):
            continue
        docs = [x for x in (d.get('Documents') or []) if x.get('DocType') == 'VEND_BILL']
        if not docs:
            continue
        pagos.append({'docid': d['DocID'], 'fecha': d['DocDate'][:10], 'prov': d.get('RelationshipID'),
                      'benef': (d.get('Beneficiary') or '?')[:26], 'monto': c2(d.get('TotalAmount')),
                      'aplicado': {x['DocID'] for x in docs}})
    return facturas, pagos


def agrupar(items, clave='prov'):
    g = collections.defaultdict(list)
    for it in items:
        g[it[clave]].append(it)
    return g


def main():
    facturas, pagos = cargar()
    fac, pag = agrupar(facturas.values()), agrupar(pagos)
    r = collections.Counter()
    ambiguos = collections.Counter()

    for prov, sus in pag.items():
        consumidas = set()
        for p in sorted(sus, key=lambda x: (x['fecha'], x['docid'])):
            cands = sorted((f for f in fac.get(prov, [])
                            if f['fecha'] <= p['fecha'] and f['docid'] not in consumidas),
                           key=lambda f: (f['fecha'], f['docid']))
            exactas = [f for f in cands if abs(f['total'] - p['monto']) < 0.005]
            if len(exactas) > 1:
                r['ambiguo -> pide elegir'] += 1
                ambiguos[p['benef']] += 1
                if p['aplicado'] <= {f['docid'] for f in exactas}:
                    r['  ...y la real estaba listada'] += 1
            elif len(exactas) == 1:
                r['acierto unico' if {exactas[0]['docid']} == p['aplicado']
                  else 'EQUIVOCADO'] += 1
            else:
                r['sin exacta (va a suma corrida)'] += 1
            # Se consume lo que el pago REAL aplicó, no lo que el algoritmo
            # propuso: si no, un error temprano contamina toda la historia.
            consumidas |= p['aplicado']

    total = sum(v for k, v in r.items() if not k.startswith(' '))
    print(f'=== Backtest sobre {total} pagos históricos ===')
    for k, v in r.most_common():
        print(f'  {k:34} {v:4}')
    print('\nQuién genera la ambigüedad (montos redondos y repetidos):')
    for b, n in ambiguos.most_common(8):
        print(f'  {b:28} {n}')


if __name__ == '__main__':
    main()
