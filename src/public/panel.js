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
      co.querySelectorAll('.prod').forEach((row) => {
        const name = row.querySelector('[name=productName]'), price = row.querySelector('[name=productPrice]');
        const hasName = !!name.value.trim(), hasPrice = !!price.value.trim();
        name.setCustomValidity(hasPrice && !hasName ? 'Informe o nome do produto.' : '');
        price.setCustomValidity(hasName && !cents(price.value) ? 'Informe o preço do produto.' : '');
        if (hasName) total += cents(price.value);
      });
      total = Math.max(0, total - cents(co.querySelector('#ds')?.value));
      co.querySelectorAll('[data-total]').forEach((e) => { e.textContent = brl(total); });
      const method = co.querySelector('input[name=method1]:checked')?.value;
      const method2 = co.querySelector('#m2'), amount2 = co.querySelector('#a2');
      const second = cents(amount2.value);
      method2.setCustomValidity(amount2.value.trim() && !method2.value ? 'Selecione a segunda forma de pagamento.'
        : method2.value && method2.value === method ? 'Escolha duas formas de pagamento diferentes.' : '');
      amount2.setCustomValidity(method2.value && (second <= 0 || second >= total) ? 'Informe uma parte maior que zero e menor que o total.' : '');
      const cashDue = method === 'dinheiro' ? total - (method2.value ? second : 0) : method2.value === 'dinheiro' ? second : 0;
      const received = co.querySelector('[data-received]'), change = co.querySelector('[data-change]');
      const usingCash = method === 'dinheiro' || method2.value === 'dinheiro';
      co.querySelector('.cash-only').hidden = !usingCash;
      received.disabled = !usingCash;
      const difference = cents(received.value) - cashDue;
      const showChange = usingCash && !!received.value.trim();
      received.setCustomValidity(showChange && difference < 0 ? 'O dinheiro recebido é insuficiente.' : '');
      change.textContent = showChange ? (difference < 0 ? `Faltam ${brl(-difference)}` : `Troco: ${brl(difference)}`) : '';
    };
    co.addEventListener('input', calc); co.addEventListener('change', calc); calc();
  }

  // botões de envio: evita clique duplo (dois agendamentos, duas cobranças)
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!(f instanceof HTMLFormElement) || f.method.toLowerCase() !== 'post') return;
    if (f.dataset.sent) { e.preventDefault(); return; }
    f.dataset.sent = '1';
    if (f.classList.contains('remind')) {
      window.addEventListener('focus', () => location.reload(), { once: true });
    }
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

  // tela Hoje: atualiza sozinha a cada 2 minutos (barbeiro deixa aberta no balcão), menos se alguém estiver digitando
  if (document.body.classList.contains('page-hoje')) {
    setInterval(() => {
      if (document.visibilityState === 'visible' && !document.querySelector('input:focus, select:focus, textarea:focus, details[open]')) location.reload();
    }, 120_000);
  }
})();
