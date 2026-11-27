// Site e página da barbearia: evita enviar o mesmo formulário duas vezes (toque duplo no celular, internet lenta).
// Não desativa o botão (o valor dele precisa ir junto); só ignora o segundo envio e mostra que está aguardando.
(() => {
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!(f instanceof HTMLFormElement) || f.method.toLowerCase() !== 'post') return;
    if (f.dataset.sent) { e.preventDefault(); return; }
    f.dataset.sent = '1';
    const b = e.submitter;
    if (b) b.setAttribute('aria-busy', 'true');
    setTimeout(() => { delete f.dataset.sent; if (b) b.removeAttribute('aria-busy'); }, 8000);
  });
  // voltar pelo navegador não deixa o formulário travado
  window.addEventListener('pageshow', () => document.querySelectorAll('form[data-sent]').forEach((f) => { delete f.dataset.sent; f.querySelectorAll('[aria-busy]').forEach((b) => b.removeAttribute('aria-busy')); }));

  // Endereço da página: vai normalizando o que a pessoa digita (maiúscula, acento, .com.br, etc.).
  const slugInput = document.querySelector('#shop-slug, input[name="slug"]');
  if (slugInput instanceof HTMLInputElement) {
    const normalizeSlug = (v) => {
      let t = String(v ?? '').trim().toLowerCase();
      t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
      t = t.replace(/^www\./, '');
      t = t.replace(/[/?#].*$/, '');
      t = t.replace(/:\d+$/, '');
      t = t.replace(/\.+$/, '');
      t = t.replace(/\.(com\.br|net\.br|org\.br|com|net|org|app|dev|io|co|info|biz|br)$/i, '');
      t = t.normalize('NFD').replace(/\p{M}/gu, '');
      t = t.replace(/&/g, 'e');
      t = t.replace(/[\s._]+/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
      if (t.length > 40) t = t.slice(0, 40).replace(/-+$/g, '');
      return t;
    };
    const apply = () => {
      const next = normalizeSlug(slugInput.value);
      if (slugInput.value !== next) slugInput.value = next;
    };
    slugInput.addEventListener('input', apply);
    slugInput.addEventListener('blur', apply);
    slugInput.form?.addEventListener('submit', apply);
  }
})();
