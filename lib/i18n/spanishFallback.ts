import { es } from './locales/es';
import { translate } from './translate';

export type Translator = (key: string, replacements?: Record<string, string>) => string;

const dictionaries = { es };

export const spanishFallback: Translator = (key, replacements) =>
  translate(dictionaries, 'es', key, replacements);
