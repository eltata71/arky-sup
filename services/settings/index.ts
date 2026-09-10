/**
 * `services/settings` — las preferencias de una persona como contexto propio.
 *
 * Era el único de los siete contextos guardados en `firestoreService` que no
 * tenía repositorio, y por eso `context/app/useSettingsState` y
 * `useAppBootstrap` llamaban al monolito directamente: sin puerta a la que
 * llamar, la UI llamaba a la base de datos.
 *
 * Es un contexto pequeño y legítimo: un documento por usuario, sin relación
 * con la jerarquía de iniciativas y proyectos, y con su propia regla en
 * `firestore.rules`.
 */
export { settingsRepository, type SettingsRepository } from './SettingsRepository';
