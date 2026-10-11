import { useEffect, useRef, useState } from 'react';

/**
 * True when `happened` turned from false to true while this component was on
 * screen (13.5). A generation that was already finished when the screen
 * opened is a fact, not an event: animating it on every visit would celebrate
 * the same thing each time someone looks.
 */
export function useJustHappened(happened: boolean): boolean {
  const previous = useRef(happened);
  const [just, setJust] = useState(false);
  useEffect(() => {
    if (happened && !previous.current) setJust(true);
    if (!happened) setJust(false);
    previous.current = happened;
  }, [happened]);
  return just;
}
