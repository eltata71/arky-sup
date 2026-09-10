import { useCallback, useRef, useState } from 'react';

export interface UseArtifactSpeechResult {
  isSpeaking: boolean;
  toggleSpeech: () => void;
}

/**
 * Owns the text-to-speech playback state for the artifact canvas. The actual
 * audio synthesis is stubbed (a 3s timer) exactly as the legacy canvas did;
 * the hook keeps a ref to the active buffer source so a future real
 * implementation can stop playback on toggle.
 */
export const useArtifactSpeech = (): UseArtifactSpeechResult => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const toggleSpeech = useCallback(() => {
    setIsSpeaking((prev) => {
      if (prev) {
        audioSourceRef.current?.stop();
        return false;
      }
      window.setTimeout(() => setIsSpeaking(false), 3000);
      return true;
    });
  }, []);

  return { isSpeaking, toggleSpeech };
};
