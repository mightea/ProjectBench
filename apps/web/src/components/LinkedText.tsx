const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;

/** Plain text with its web addresses as links. Closing punctuation stays outside the link. */
export function LinkedText({ text }: { text: string }) {
  return text.split(URL_PATTERN).map((part, i) => {
    if (i % 2 === 0) return part;
    const url = part.replace(/[.,;:!?)\]]+$/, '');
    return (
      <span key={i}>
        <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium break-all text-(--look-ink) underline">
          {url}
        </a>
        {part.slice(url.length)}
      </span>
    );
  });
}
