// Atalhos do painel. Tudo continua funcionando sem JavaScript; aqui só se poupa clique.
(() => {
  // escolher a data já abre o dia (sem botão "Ir")
  for (const input of document.querySelectorAll('form.datepick input[type=date]')) {
    input.form.classList.add('js');
    input.addEventListener('change', () => input.value && input.form.submit());
  }

  // novo horário: escolher alguém da lista preenche nome e WhatsApp
  const nm = document.getElementById('nm'), ph = document.getElementById('ph');
  if (nm && ph && nm.list) {
    nm.addEventListener('input', () => {
      const i = nm.value.indexOf(' — ');
      if (i > 0 && [...nm.list.options].some((o) => o.value === nm.value)) { ph.value = nm.value.slice(i + 3); nm.value = nm.value.slice(0, i); }
    });
  }

  // comanda: total, troco e forma de pagamento ao vivo (o servidor recalcula tudo ao salvar)
  const co = document.querySelector('form.co');
  if (co) {
    const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const cents = (v) => { v = String(v || '').replace(/[R$\s]/g, ''); if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.'); const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };
    const calc = () => {
      let total = Number(co.dataset.fixed || 0);
      co.querySelectorAll('input[name=svc]:checked').forEach((i) => { total += Number(i.dataset.price || 0); });
      co.querySelectorAll('input[name=productPrice]').forEach((i) => { total += cents(i.value); });
      total = Math.max(0, total - cents(co.querySelector('#ds')?.value));
      co.querySelectorAll('[data-total]').forEach((e) => { e.textContent = brl(total); });
      const method = co.querySelector('input[name=method1]:checked')?.value;
      const cash = co.querySelector('.cash-only');
      if (cash) cash.hidden = method !== 'dinheiro';
      const rec = cents(co.querySelector('[data-received]')?.value), out = co.querySelector('[data-change]');
      const second = cents(co.querySelector('#a2')?.value);
      if (out) out.textContent = rec ? (rec >= total - second ? `Troco: ${brl(rec - (total - second))}` : `Faltam ${brl(total - second - rec)}`) : '';
    };
    co.addEventListener('input', calc); co.addEventListener('change', calc); calc();
  }

  // botões de envio: evita clique duplo (dois agendamentos, duas cobranças)
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!(f instanceof HTMLFormElement) || f.method.toLowerCase() !== 'post') return;
    if (f.dataset.sent) { e.preventDefault(); return; }
    f.dataset.sent = '1';
    setTimeout(() => { delete f.dataset.sent; }, 4000);
  });

  // editor de horários: repetir o horário do primeiro dia aberto nos outros dias abertos
  for (const week of document.querySelectorAll('div.week')) {
    const rows = [...week.querySelectorAll('.wrow')];
    if (rows.length < 2) continue;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn sm copy-week';
    btn.textContent = 'Repetir o horário do primeiro dia aberto nos outros';
    btn.addEventListener('click', () => {
      const open = rows.filter((r) => r.querySelector('.switch input').checked);
      if (open.length < 2) return;
      const vals = [...open[0].querySelectorAll('.times input')].map((i) => i.value);
      for (const r of open.slice(1)) r.querySelectorAll('.times input').forEach((i, k) => { i.value = vals[k]; });
      btn.textContent = 'Pronto. Confira e salve.';
    });
    week.after(btn);
  }

  // lembrete: o WhatsApp abre em outra aba; aqui a linha já mostra que foi enviado
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!(f instanceof HTMLFormElement) || !f.classList.contains('remind')) return;
    setTimeout(() => {
      const row = f.closest('li'), st = row && row.querySelector('.rm');
      if (st && !st.classList.contains('ok')) { st.className = 'rm sent'; st.textContent = 'Enviado agora'; }
      const b = f.querySelector('button'); if (b) { b.classList.remove('primary'); b.lastChild.textContent = ' Reenviar'; }
    }, 300);
  });

  // tela Hoje: atualiza sozinha a cada 2 minutos (barbeiro deixa aberta no balcão), menos se alguém estiver digitando
  if (document.body.classList.contains('page-hoje')) {
    setInterval(() => {
      if (document.visibilityState === 'visible' && !document.querySelector('input:focus, select:focus, textarea:focus, details[open]')) location.reload();
    }, 120_000);
  }
})();
