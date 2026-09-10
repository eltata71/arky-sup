/**
 * Las piezas propias del centro de mando.
 *
 * Viven aquí y no en `components/architectureOffice/dashboard/` porque cruzan
 * los tres niveles gobernados: la Oficina es uno de ellos, y meter la cabecera
 * del portafolio dentro de su carpeta diría que la salud del conjunto es un
 * asunto de los entregables.
 */
export { PortfolioHealthHero } from './PortfolioHealthHero';
export type { PortfolioHealthHeroProps } from './PortfolioHealthHero';
export { AttentionCenter } from './AttentionCenter';
export type { AttentionCenterProps } from './AttentionCenter';
