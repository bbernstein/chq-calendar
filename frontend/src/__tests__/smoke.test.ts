describe('test setup', () => {
  it('works', () => {
    expect(1 + 1).toBe(2);
  });

  it('has localStorage', () => {
    localStorage.setItem('test', 'value');
    expect(localStorage.getItem('test')).toBe('value');
    localStorage.clear();
  });
});
