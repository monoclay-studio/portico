import { CircleHelp } from 'lucide-react';
import { useUi } from '../provider';
import { IconButton } from './button';

/** Opens contextual help for a stable help anchor (`<module>.<screen>[.<element>]`). */
export function HelpButton({ helpKey, onOpen }: { helpKey: string; onOpen: (helpKey: string) => void }) {
  const { strings } = useUi();
  return (
    <IconButton
      size="sm"
      label={strings.record.help}
      icon={<CircleHelp />}
      data-help-key={helpKey}
      onClick={() => onOpen(helpKey)}
    />
  );
}
