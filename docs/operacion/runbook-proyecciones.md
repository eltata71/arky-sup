# Runbook — El grafo de conocimiento de un proyecto no se actualiza

**Síntoma:** un proyecto muestra un grafo de conocimiento que no refleja sus
artefactos recientes, o el centro de observabilidad registra fallos de
`recoverGraphProjections`.

**Cómo funciona** (ADR-107):

1. Escribir un artefacto de un proyecto **que ya tiene grafo** deja un
   pendiente en `api.projection_outbox`, en la misma transacción.
2. La aplicación procesa los pendientes del usuario al arrancar, y también
   tras el periodo de espera cuando está abierta.
3. Guardar la proyección la marca procesada. Reprocesar es inocuo.

## 1. ¿Hay un pendiente?

Con la sesión del usuario afectado (en su navegador, consola de desarrollo):

```js
const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
const token = JSON.parse(localStorage.getItem(key)).access_token;
await (await fetch(`${location.origin.includes('localhost') ? 'http://127.0.0.1:54321' : '<VITE_SUPABASE_URL>'}/rest/v1/rpc/list_pending_projections`, {
  method: 'POST',
  headers: { apikey: '<clave publicable>', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Profile': 'api' },
  body: '{}',
})).json();
```

Cada entrada trae `projectId`, `generation`, `processedGeneration`,
`attempts` y `lastError`.

| Lo que se ve | Qué significa | Qué hacer |
|---|---|---|
| Lista vacía y grafo viejo | El proyecto **no tiene grafo** (la bitácora sólo mantiene los que existen), o el cambio no pasó por una RPC de artefactos | Abrir el proyecto: la reconstrucción normal lo crea |
| Pendiente con `attempts: 0` | Nadie ha abierto la aplicación desde el cambio | Abrir la aplicación con esa cuenta |
| Pendiente con `attempts > 0` y `lastError` | La reconstrucción falla | §2 |
| Pendiente que vuelve tras procesarse | Se siguen escribiendo artefactos: cada escritura sube la generación | Nada: es lo esperado |

## 2. La reconstrucción falla

- **`El proyecto no se pudo leer para reconstruir su grafo.`** La lectura
  fresca del proyecto falló. Hay que comprobar que el proyecto existe y es de
  ese usuario (`load_project_aggregate`).
- **Un error de validación (`22023`) al guardar.** El grafo construido no
  cumple la forma que exige `save_knowledge_graph`: un defecto del
  constructor. Se reproduce con el proyecto en
  `__tests__/architectureProjects/graphProjectionRecovery.test.ts`.
- **`stale` / `already-processed` en el informe.** No son fallos: otra pestaña
  o un arranque anterior ya lo procesó.

## 3. Lo que no se hace

- **Borrar filas de `api.projection_outbox` a mano.** Un pendiente borrado es
  un grafo que se queda viejo sin que nada lo sepa, que es exactamente el
  defecto H11. Si el grafo de un proyecto ya no hace falta, se borra el grafo:
  su pendiente se va con él (disparador `forget_graph_projection`).
- **Llamar a `save_knowledge_graph` para «forzar».** Guarda un grafo, pero no
  marca la generación. El pendiente sigue ahí y se volverá a procesar.
