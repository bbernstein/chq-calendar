import { render } from '@testing-library/preact';
import { describe, it, expect } from 'vitest';

describe('vitest smoke', () => {
  it('renders a div with preact and finds it via testing-library', () => {
    const { getByText } = render(<div>hello</div>);
    expect(getByText('hello')).toBeInTheDocument();
  });
});
