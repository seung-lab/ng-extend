/**
 * nge: Pyr's own "are you sure" box, in place of the browser's (Ames
 * 2026-10-15: the browser's box showed the site's address and did not look
 * like Pyr). Enter confirms, Esc or a click outside cancels.
 */
export function ngeConfirm(
    message: string, options: {title?: string, ok?: string, danger?: boolean} = {}): Promise<boolean> {
  return new Promise(resolve => {
    document.querySelector('.nge-confirm-backdrop')?.remove();
    const backdrop = document.createElement('div');
    backdrop.className = 'nge-confirm-backdrop';
    const box = document.createElement('div');
    box.className = 'nge-confirm';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    if (options.title) {
      const t = document.createElement('div');
      t.className = 'nge-confirm-title';
      t.textContent = options.title;
      box.appendChild(t);
    }
    const m = document.createElement('div');
    m.className = 'nge-confirm-message';
    m.textContent = message;
    box.appendChild(m);
    const row = document.createElement('div');
    row.className = 'nge-confirm-buttons';
    const cancel = document.createElement('button');
    cancel.className = 'nge-confirm-cancel';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.className = 'nge-confirm-ok' + (options.danger === false ? '' : ' nge-confirm-danger');
    ok.textContent = options.ok ?? 'Remove';
    row.append(cancel, ok);
    box.appendChild(row);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    const done = (answer: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(answer);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
    };
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) done(false); });
    ok.focus();
  });
}

/**
 * nge: the same box with more than two answers (Ames 2026-10-16: the folder
 * ✕ asks whether its cells stay in view or go too). Resolves to the chosen
 * value, or null for Cancel, Esc or a click outside. Enter picks `defaultValue`.
 */
export function ngeChoose<T extends string>(
    message: string,
    options: {title?: string, choices: {label: string, value: T, danger?: boolean}[], defaultValue: T}):
    Promise<T|null> {
  return new Promise(resolve => {
    document.querySelector('.nge-confirm-backdrop')?.remove();
    const backdrop = document.createElement('div');
    backdrop.className = 'nge-confirm-backdrop';
    const box = document.createElement('div');
    box.className = 'nge-confirm';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    if (options.title) {
      const t = document.createElement('div');
      t.className = 'nge-confirm-title';
      t.textContent = options.title;
      box.appendChild(t);
    }
    const m = document.createElement('div');
    m.className = 'nge-confirm-message';
    m.textContent = message;
    box.appendChild(m);
    const row = document.createElement('div');
    row.className = 'nge-confirm-buttons nge-confirm-buttons--choices';
    const done = (answer: T|null) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(answer);
    };
    const cancel = document.createElement('button');
    cancel.className = 'nge-confirm-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => done(null));
    row.appendChild(cancel);
    let focusMe: HTMLButtonElement|undefined;
    for (const c of options.choices) {
      const b = document.createElement('button');
      b.className = 'nge-confirm-ok' + (c.danger ? ' nge-confirm-danger' : '');
      b.textContent = c.label;
      b.addEventListener('click', () => done(c.value));
      if (c.value === options.defaultValue) focusMe = b;
      row.appendChild(b);
    }
    box.appendChild(row);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(options.defaultValue); }
    };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) done(null); });
    focusMe?.focus();
  });
}
