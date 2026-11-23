import { useEffect, useState, type ChangeEvent } from 'react';
import { CloseIcon } from './icons.tsx';
import { inputClass } from './Sheet.tsx';

/** A date input that opens its picker on click and can be cleared. */
export function DateField({ id, value, onCommit }: { id: string; value: string | null; onCommit: (date: string | null) => void }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);

  const change = (e: ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    // While a year is being typed the input reports dates like 0002-03-01.
    if (e.target.value >= '2000-01-01') onCommit(e.target.value);
  };

  return (
    <div className="flex items-center gap-1.5">
      <input
        id={id}
        type="date"
        value={text}
        onChange={change}
        onBlur={() => {
          if (!text && value) onCommit(null);
        }}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker();
          } catch {
            // Not supported everywhere; the field can still be typed in.
          }
        }}
        className={inputClass}
      />
      {text && (
        <button
          type="button"
          onClick={() => {
            setText('');
            onCommit(null);
          }}
          aria-label="Clear due date"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-ground"
        >
          <CloseIcon width={18} height={18} />
        </button>
      )}
    </div>
  );
}
