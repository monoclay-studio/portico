import { createContext, useContext } from 'react';

export const HelpContext = createContext<{ openHelp: (helpKey: string) => void }>({ openHelp: () => {} });

export function useHelp() {
  return useContext(HelpContext);
}
