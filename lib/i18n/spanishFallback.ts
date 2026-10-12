import { spanishDictionary } from './spanishStore';
import { translate } from './translate';

export type Translator = (key: string, replacements?: Record<string, string>) => string;

export const spanishFallback: Translator = (key, replacements) =>
  translate({ es: spanishDictionary }, 'es', key, replacements);
