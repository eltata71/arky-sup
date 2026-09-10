/** Public surface for the compiler validators. */
export {
  analyzeDocumentStructure,
  isSectionPresent,
  type DocumentStructure,
  type HeadingInfo,
} from './sectionValidator';
export {
  validateAgainstContract,
  type ContractValidationResult,
} from './contractValidator';
