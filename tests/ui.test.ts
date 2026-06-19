import { describe, expect, it } from 'vitest';
import { initApp } from '../src/app';

describe('strategy dashboard', () => {
  it('renders hero and core sections', () => {
    const root = document.createElement('div');
    initApp(root);

    expect(root.querySelector('[data-testid="hero-title"]')?.textContent).toContain('左侧交易');
    expect(root.querySelectorAll('[data-testid="decision-step"]').length).toBe(4);
    expect(root.querySelectorAll('[data-testid="checkpoint-item"]').length).toBe(5);
    expect(root.querySelector('[data-testid="allocation-table"]')).not.toBeNull();
  });
});
