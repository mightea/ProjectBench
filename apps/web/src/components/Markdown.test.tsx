import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown.tsx';

describe('Markdown', () => {
  it('renders headings, lists, emphasis and tables', () => {
    render(<Markdown text={'## Fit check\n\n- **Depth** 2U\n- [x] Ordered\n\n| Part | Qty |\n| --- | --- |\n| Fan | 2 |'} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Fit check' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Depth').tagName).toBe('STRONG');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('cell', { name: 'Fan' })).toBeTruthy();
  });

  it('keeps the line breaks of a plain-text note and links bare addresses', () => {
    const { container } = render(<Markdown text={'Measured 438 mm\nsee https://example.com/tray.'} />);
    expect(container.querySelectorAll('br')).toHaveLength(1);
    const link = screen.getByRole('link', { name: 'https://example.com/tray' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows raw HTML as text, drops script links and does not load images', () => {
    const { container } = render(<Markdown text={'<img src=x onerror=alert(1)> [x](javascript:alert(1)) ![plan](https://example.com/plan.png)'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'plan' }).getAttribute('href')).toBe('https://example.com/plan.png');
  });
});
