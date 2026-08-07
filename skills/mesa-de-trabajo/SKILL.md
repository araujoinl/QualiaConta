---
name: mesa-de-trabajo
description: "Atiende la mesa de trabajo web: facturas que suben desde Labs_Inv, propuesta de registro, aprobaciones y libro. Lee y escribe la cola qualia_* por SQL. Se activa por el webhook mesa."
version: 1.0.0
author: QualiaConta
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [Contabilidad, Mesa, Facturas, Registro]
prerequisites:
  env: [QUALIA_DSN, QUALIA_EMPRESA_ID]
  commands: [psql, curl]
---

# La mesa de trabajo

Este archivo es sólo la puerta. **Tu PRIMER comando, siempre, es abrirlo:**

```bash
bash /opt/data/skills/qualiaconta/mesa-de-trabajo/scripts/abrir-trabajo.sh <trabajo_id>
```

Ese script lee la fila en la base y te imprime dos cosas: los datos del trabajo
y, pegado, **el procedimiento que te toca**. Lo que te imprima ES tu manual: no
busques otro archivo ni supongas pasos que no estén ahí.

Existe para no hacerte leer las 60 páginas del manual cuando el trabajo es
mecánico. Dos casos lo son —escribir una entrada del libro, y registrar en ADM
algo que ya aprobó un humano— y ésos reciben un extracto. **Todo lo demás
—analizar, atender una corrección, un caso, un criterio— recibe el manual
completo, igual que siempre.** Si el trabajo tiene algo de contabilidad, no te
van a faltar reglas.

Si el script falla o no puede decidir, te imprime el manual completo y te lo
dice por stderr. Trabajás igual: leer de más es barato, trabajar con medio
cerebro no.

Y si por lo que sea corriste sin él, hacé `cat` de
`/opt/data/skills/qualiaconta/mesa-de-trabajo/references/manual.md` ANTES de
tocar la fila.
