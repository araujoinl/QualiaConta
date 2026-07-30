# Skills

Lo que le enseña a ser contable dominicano. Estándar abierto de
[agentskills.io](https://agentskills.io), que es el que usa Hermes.

Dos orígenes, mismo trato:

- **Semilla** — las que escribimos nosotros para arrancar.
- **Generadas** — las que el contable escribe solo cuando un caso se repite, que
  es la meta declarada del proyecto: sacarse trabajo de encima.

Las generadas **también van en git**. Se revisan como cualquier código: si el
contable escribió un script que registra mal, se ve en el diff. Una skill que
nadie miró nunca y que corre sola sobre el libro oficial es justo lo que no
queremos.

## Reglas

1. Una skill resuelve un caso y **explica en qué se apoya**.
2. Si necesita una regla fiscal, la **cita del núcleo** con su norma. No la lleva
   escrita adentro: cuando la DGII cambie algo, se actualiza en un solo lugar.
3. **Nada de credenciales** dentro de una skill. Van en el `.env`.
4. Si una skill relee el histórico en cada ejecución, está mal diseñada. Destilar
   es una operación de una sola vez.

## Semilla planeada (entrega 1)

| Skill | Qué hace |
|---|---|
| `consultar-admcloud` | Traduce una pregunta a SQL, ejecuta y responde con el número **y la consulta que lo produjo** |
| `destilar-liquidaciones` | Lee las carpetas históricas y saca los criterios de reparto por costo y proveedor |
| `consultar-nucleo-dgii` | Busca una regla con su rango y su vigencia a la fecha del documento |
| `escribir-libro-de-accion` | Crea la entrada de una decisión. Archivo nuevo, nunca edición |
