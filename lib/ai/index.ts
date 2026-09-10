/**
 * `lib/ai` — lo que la capa de IA declara y todo el mundo necesita leer.
 *
 * Hoy sólo el catálogo de modelos. Estuvo en la raíz de `services/` y por un
 * momento dentro de `services/ai/catalog/`, hasta que el gate de fronteras
 * dijo lo que era: cinco contextos distintos —el arranque de la aplicación,
 * el agente, el chat, los artefactos y la pantalla de Ajustes— necesitan
 * resolver qué modelo implica un `Settings`, y meter eso dentro de
 * `services/ai` convertía a la capa de IA en dependencia de todos ellos, con
 * un ciclo `ai <-> chat` de regalo.
 *
 * Es el patrón que `CLAUDE.md` ya nombra: un contrato sin comportamiento baja
 * a una hoja. Este fichero son ids de modelo, tramos de coste, una cadena de
 * respaldo y funciones puras de `Settings` a un id. No llama a nadie, no
 * conoce a ningún proveedor y su única dependencia es `Settings`.
 *
 * La regla de CLAUDE.md sigue en pie y este fichero es su excepción declarada:
 * un id de modelo concreto se nombra aquí, en el catálogo, y en un adaptador
 * de proveedor. En ningún otro sitio.
 */
export * from './modelCatalog';
