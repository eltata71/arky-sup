import React from 'react';
import { useAppContext } from '../context/AppContext';
import { 
  BoldIcon, ItalicIcon, StrikethroughIcon, Heading1Icon, Heading2Icon, Heading3Icon, 
  ListUnorderedIcon, ListOrderedIcon, QuoteIcon, CodeBlockIcon 
} from './Icons';

interface MarkdownToolbarProps {
  onInsert: (text: string, block?: boolean) => void;
}

const ToolbarButton: React.FC<{ onClick: () => void; children: React.ReactNode; title: string; className?: string }> = ({ onClick, children, title, className = "" }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={`p-2 text-gray-500 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500 flex-shrink-0 ${className}`}
  >
    {children}
  </button>
);

type ToolbarItem = { key: string; insert: string; block?: boolean; Icon?: React.FC<{ className?: string }>; glyph?: string };

const GROUPS: ToolbarItem[][] = [
  [
    { key: 'h1', insert: '# ', block: true, Icon: Heading1Icon },
    { key: 'h2', insert: '## ', block: true, Icon: Heading2Icon },
    { key: 'h3', insert: '### ', block: true, Icon: Heading3Icon },
  ],
  [
    { key: 'bold', insert: '**bold text**', Icon: BoldIcon },
    { key: 'italic', insert: '*italic text*', Icon: ItalicIcon },
    { key: 'strike', insert: '~~strikethrough~~', Icon: StrikethroughIcon },
  ],
  [
    { key: 'quote', insert: '> ', block: true, Icon: QuoteIcon },
    { key: 'ul', insert: '\n- List item', Icon: ListUnorderedIcon },
    { key: 'ol', insert: '\n1. List item', Icon: ListOrderedIcon },
    { key: 'code', insert: '\n```\ncode\n```', Icon: CodeBlockIcon },
  ],
  [
    { key: 'arrow', insert: '-->', glyph: '-->' },
    { key: 'dotted', insert: '-.->', glyph: '-.->' },
    { key: 'node', insert: 'Node[Text]', glyph: '[]' },
    { key: 'round', insert: 'Node(Text)', glyph: '()' },
    { key: 'subgraph', insert: '\nsubgraph Name\n  \nend', glyph: 'sub' },
  ],
];

export const MarkdownToolbar: React.FC<MarkdownToolbarProps> = ({ onInsert }) => {
  const { t } = useAppContext();
  return (
    <div className="flex items-center p-1 space-x-1 bg-gray-100 border-b border-gray-200 dark:bg-gray-900/50 dark:border-gray-700 sticky top-0 z-10 overflow-x-auto no-scrollbar">
      {GROUPS.map((group, index) => (
        <React.Fragment key={group[0].key}>
          {index > 0 && <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1 flex-shrink-0"></div>}
          {group.map(({ key, insert, block, Icon, glyph }) => (
            <ToolbarButton
              key={key}
              onClick={() => onInsert(insert, block)}
              title={t(`markdownToolbar.${key}`)}
              className={glyph ? 'font-mono text-xs font-bold' : ''}
            >
              {Icon ? <Icon className="w-5 h-5" /> : glyph}
            </ToolbarButton>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
};
