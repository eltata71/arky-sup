import React from 'react';
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

export const MarkdownToolbar: React.FC<MarkdownToolbarProps> = ({ onInsert }) => {
  return (
    <div className="flex items-center p-1 space-x-1 bg-gray-100 border-b border-gray-200 dark:bg-gray-900/50 dark:border-gray-700 sticky top-0 z-10 overflow-x-auto no-scrollbar">
      <ToolbarButton onClick={() => onInsert('# ', true)} title="Heading 1"><Heading1Icon className="w-5 h-5"/></ToolbarButton>
      <ToolbarButton onClick={() => onInsert('## ', true)} title="Heading 2"><Heading2Icon className="w-5 h-5"/></ToolbarButton>
      <ToolbarButton onClick={() => onInsert('### ', true)} title="Heading 3"><Heading3Icon className="w-5 h-5"/></ToolbarButton>
      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1 flex-shrink-0"></div>
      <ToolbarButton onClick={() => onInsert('**bold text**')} title="Bold"><BoldIcon className="w-5 h-5"/></ToolbarButton>
      <ToolbarButton onClick={() => onInsert('*italic text*')} title="Italic"><ItalicIcon className="w-5 h-5"/></ToolbarButton>
      <ToolbarButton onClick={() => onInsert('~~strikethrough~~')} title="Strikethrough"><StrikethroughIcon className="w-5 h-5"/></ToolbarButton>
      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1 flex-shrink-0"></div>
      <ToolbarButton onClick={() => onInsert('> ', true)} title="Quote"><QuoteIcon className="w-5 h-5"/></ToolbarButton>
      <ToolbarButton onClick={() => onInsert('\n- List item')} title="Unordered List"><ListUnorderedIcon className="w-5 h-5"/></ToolbarButton>
      <ToolbarButton onClick={() => onInsert('\n1. List item')} title="Ordered List"><ListOrderedIcon className="w-5 h-5"/></ToolbarButton>
      <ToolbarButton onClick={() => onInsert('\n```\ncode\n```')} title="Code Block"><CodeBlockIcon className="w-5 h-5"/></ToolbarButton>
      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1 flex-shrink-0"></div>
      <ToolbarButton onClick={() => onInsert('-->')} title="Mermaid Arrow" className="font-mono text-xs font-bold">--&gt;</ToolbarButton>
      <ToolbarButton onClick={() => onInsert('-.->')} title="Mermaid Dotted Arrow" className="font-mono text-xs font-bold">-.-&gt;</ToolbarButton>
      <ToolbarButton onClick={() => onInsert('Node[Text]')} title="Mermaid Node" className="font-mono text-xs font-bold">[]</ToolbarButton>
      <ToolbarButton onClick={() => onInsert('Node(Text)')} title="Mermaid Round Node" className="font-mono text-xs font-bold">()</ToolbarButton>
      <ToolbarButton onClick={() => onInsert('\nsubgraph Name\n  \nend')} title="Mermaid Subgraph" className="font-mono text-xs font-bold">sub</ToolbarButton>
    </div>
  );
};