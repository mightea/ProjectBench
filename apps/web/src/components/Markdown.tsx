import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  // Remote images would load from other servers as soon as a note is shown, so they stay links.
  img: ({ src, alt }) => (
    <a href={src} target="_blank" rel="noopener noreferrer">
      {alt || src}
    </a>
  ),
  // A wide table scrolls on its own instead of widening the card.
  table: ({ node: _node, ...props }) => (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  ),
};

const plugins = [remarkGfm, remarkBreaks];

/**
 * Markdown as written by hand or by Claude: GitHub flavor (tables, task lists, bare links) with every
 * line break kept, so plain-text notes look as typed. Raw HTML is shown as text, never rendered.
 */
export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`markdown ${className}`}>
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
