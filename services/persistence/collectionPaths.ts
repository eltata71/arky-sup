/**
 * Dónde vive cada cosa en Firestore, dicho una sola vez.
 *
 * Estos nombres estuvieron dentro de `services/firestoreService.ts` como
 * constantes privadas de una clase de 1 379 líneas. Eso funcionaba mientras
 * esa clase era el único fichero que hablaba con la base de datos; en cuanto
 * cada contexto pasó a tener su repositorio, la alternativa era que seis
 * módulos escribieran `"projects"` a mano.
 *
 * Son infraestructura compartida y no dominio: la jerarquía que describen
 * —una iniciativa arriba, un proyecto, sus artefactos, sus encargos— vive en
 * `lib/eaTerminology.ts` y en los tipos de cada contexto. Aquí sólo están los
 * segmentos de ruta.
 *
 * **`firestore.rules` es el espejo de este fichero.** Si cambias una ruta o la
 * forma de un documento, la regla se cambia en el mismo commit; es la única
 * frontera que decide qué se permite de verdad, porque `lib/authz` corre en un
 * navegador que controla quien llama.
 */

export const PROJECTS_COLLECTION = 'projects';
export const ARTIFACTS_COLLECTION = 'artifacts';

/**
 * Agregados que pertenecen a un proyecto pero no pueden viajar en su documento.
 *
 * El grafo de arquitectura se reconstruye con cada cambio de artefacto y crece
 * con el número de artefactos; el array de paquetes de publicación sólo crece,
 * y cada paquete arrastra una traza de auditoría que no se borra. Los dos se
 * escribían en línea, compartiendo el presupuesto de 1 MiB del proyecto con su
 * nombre, sus arrays de memoria y sus enlaces — así que un proyecto normal
 * acababa fallando al guardar con un error opaco de Firestore, y el campo
 * culpable era invisible.
 *
 * `aggregates/architectureGraph` es un documento porque un proyecto tiene
 * exactamente un grafo. Los paquetes de publicación son un documento cada uno,
 * de forma que el array que crece es una colección y no un campo.
 */
export const AGGREGATES_COLLECTION = 'aggregates';
export const ARCHITECTURE_GRAPH_DOC = 'architectureGraph';

/**
 * Índice compacto de qué artefactos existen, sin su contenido.
 *
 * Cargar todos los artefactos de todos los proyectos en el arranque —el cuerpo
 * entero del documento, para una pantalla que sólo los cuenta y los agrupa—
 * era lo más caro que hacía la aplicación al abrirse. Este documento guarda la
 * misma información de identidad a unos cien bytes por artefacto, y vive en la
 * colección `aggregates` que la lectura de un proyecto ya trae, así que no
 * cuesta ninguna ida y vuelta adicional.
 *
 * Lleva el recuento con el que se construyó. Quien lo lee sólo se fía cuando
 * coincide con el `artifactCount` del proyecto; cualquier desviación le hace
 * cargar los artefactos. Un índice desfasado cuesta una lectura lenta, nunca
 * un número equivocado en una pantalla de portafolio.
 */
export const ARTIFACT_INDEX_DOC = 'artifactIndex';
export const PUBLICATIONS_COLLECTION = 'publications';

export const SETTINGS_COLLECTION = 'settings';
export const GLOBAL_SETTINGS_DOC = 'global';

export const HISTORY_COLLECTION = 'history';
export const CHAT_DOC = 'chat';

export const AGENT_ACTIONS_COLLECTION = 'agent_actions';

export const ENGAGEMENTS_COLLECTION = 'engagements';
export const ARB_DECISIONS_COLLECTION = 'arbDecisions';

/**
 * De primer nivel, y no anidada bajo un proyecto, porque la jerarquía va al
 * revés: una iniciativa es la razón por la que un proyecto existe, y es normal
 * que una iniciativa la sirvan varios. Anidarla bajo uno cualquiera convertiría
 * el enlace de los demás en la excepción.
 */
export const BUSINESS_INITIATIVES_COLLECTION = 'businessInitiatives';

/**
 * La ficha configurada de cada agente de la Oficina, bajo el usuario que la
 * configura.
 *
 * Por usuario y no global a propósito: el reparto de personas es fijo y viene
 * con el producto, pero lo que una organización le añade a Sofía sobre su canal
 * de corredores es suyo. Un documento por agente —y no un array en el perfil—
 * porque la edición es de uno en uno y dos pestañas abiertas sobre el mismo
 * array se pisan la una a la otra.
 */
export const USERS_COLLECTION = 'users';
export const AGENT_PROFILES_COLLECTION = 'agentProfiles';
