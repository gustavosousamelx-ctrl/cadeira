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
})();
