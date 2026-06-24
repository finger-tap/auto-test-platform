import CodeMirror, { type ReactCodeMirrorProps } from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import { useThemeMode } from '../hooks/useThemeMode';

type Props = Omit<ReactCodeMirrorProps, 'theme'> & {
  extensions?: Extension[];
};

export default function ThemedCodeMirror({ extensions, ...rest }: Props) {
  const theme = useThemeMode();
  return (
    <CodeMirror
      theme={theme}
      extensions={extensions}
      {...rest}
    />
  );
}
