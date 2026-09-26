document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button.copy');
  if (!btn) return;
  const text = btn.closest('.card').querySelector('pre').innerText;
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
  catch { btn.textContent = 'Select and copy manually'; }
  setTimeout(() => (btn.textContent = 'Copy'), 1500);
});
