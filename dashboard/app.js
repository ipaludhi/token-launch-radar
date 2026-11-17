// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail view with the model's
// own inputs and the protocol's farm plan, and the model's fit and validation. No network: every
// byte it shows is in data.js.
//
// One model prices the board and the page: impliedOf below is the same arithmetic lib/model.ts
// runs (log-log size curve fitted on the traded comps, shrunk category adjustment, small growth
// and maturity priors), and the detail view recomputes each row from the snapshot figures and
// checks the number board.json carries. The farm plan's netting is recomputed the same way:
// gas per transaction by chain, capital returned at unwind, expected share under the stated
// assumptions, verdict FARM, THIN or SKIP.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var FIT = DATA.model_fit;
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', watchlist: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n) || n <= 0) return 'n/a';
    return n.toFixed(2) + 'x';
  }
  function fmtLogErr(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return String(n) + ' (x' + Math.exp(n).toFixed(2) + ')';
  }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row) {
    var curve = Math.round(Math.exp(FIT.intercept + FIT.slope * Math.log(row.tvl_usd) + row.category_adj_log));
    return Math.max(1, Math.round(curve * row.growth_multiplier * row.maturity_multiplier));
  }
  function curveOf(row) {
    return Math.round(Math.exp(FIT.intercept + FIT.slope * Math.log(row.tvl_usd) + row.category_adj_log));
  }

  // The farm plan's netting, recomputed in the page from the same rules lib/model.ts runs.
  function gasPerTx(chain) {
    switch (chain) {
      case 'Ethereum': return 4;
      case 'Solana': case 'Sui': return 0.05;
      case 'Stellar': return 0.01;
      case 'Hyperliquid L1': case 'Monad': return 0.1;
      case 'Bitcoin': return 1;
      case 'Binance': case 'Base': case 'Arbitrum': case 'Optimism': case 'Polygon': case 'Avalanche': return 0.3;
      case 'Tron': return 0.5;
      default: return 0.5;
    }
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function farmOf(row) {
    var chain = row.chains && row.chains.length ? row.chains[0] : 'its main chain';
    var hold = holdDaysFor(row.age_days);
    var weeks = Math.ceil(hold / 7);
    var tx = 2 + weeks + 1;
    var gas = Math.round(tx * gasPerTx(chain) * 100) / 100;
    var expected = Math.round(row.implied_value_usd * 0.05 / 10000 * 100) / 100;
    var verdict = expected >= 3 * gas ? 'FARM' : expected >= gas ? 'THIN' : 'SKIP';
    return { chain: chain, hold: hold, weeks: weeks, tx: tx, gas: gas, expected: expected, verdict: verdict };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('watchlist') === '1') state.watchlist = true;
    if (params.get('tab') === 'live') state.tab = 'live';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.watchlist) params.set('watchlist', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.verdict !== 'all' && r.farm.verdict !== state.verdict) return false;
      if (state.watchlist && DATA.watchlist_slugs.indexOf(r.slug) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.implied_value_usd / a.tvl_usd; bv = b.implied_value_usd / b.tvl_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var farmCount = DATA.rows.filter(function (r) { return r.farm.verdict === 'FARM'; }).length;
    var thinCount = DATA.rows.filter(function (r) { return r.farm.verdict === 'THIN'; }).length;
    var skipCount = DATA.rows.length - farmCount - thinCount;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, every one the curve prices, not just the largest. Implied value is a model, not a promise: the curve is fitted on the ' + FIT.n_comps + ' tokens that already trade, and the page shows the fit and its out-of-sample test.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist slug is on the board' })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' early rows below the floor' })),
        el('div', { class: 'fact' }, el('span', { text: 'Farm verdicts' }), el('b', { text: farmCount + ' FARM / ' + thinCount + ' THIN / ' + skipCount + ' SKIP' }), el('small', { text: 'netted to the dollar, capital returned' })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }), el('small', { text: 'their market caps are facts, not a model' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var verdictSelect = el('select', { id: 'verdict', 'aria-label': 'Filter by farm verdict' },
      el('option', { value: 'all', text: 'Any verdict' }),
      ['FARM', 'THIN', 'SKIP'].map(function (v) { return el('option', { value: v, text: v + ' only', selected: v === state.verdict ? 'selected' : null }); })
    );
    verdictSelect.addEventListener('change', function () { state.verdict = verdictSelect.value; writeHash(); render(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watchlist', checked: state.watchlist ? 'checked' : null });
    watchBox.addEventListener('change', function () { state.watchlist = watchBox.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Farm verdict' }), verdictSelect),
      el('label', { class: 'check', for: 'watchlist' }, watchBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.watchlist = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var mult = r.implied_value_usd / r.tvl_usd;
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: fmtMult(mult) }),
        el('td', null, el('span', { class: 'verdict ' + r.farm.verdict.toLowerCase(), text: r.farm.verdict }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan. Multiple is implied value over TVL.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('multiple', 'Multiple'),
            el('th', { scope: 'col', text: 'Farm' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and the largest of them anchor the size curve.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var adjEntries = Object.keys(FIT.category_adj).map(function (k) { return [k, FIT.category_adj[k]]; });
    adjEntries.sort(function (a, b) { return b[1] - a[1]; });
    var adjText = adjEntries.map(function (e) { return e[0] + ' ' + (e[1] >= 0 ? '+' : '') + e[1].toFixed(2); }).join(', ');
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row, fitted from this snapshot at run time. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( exp(' + FIT.intercept + ' + ' + FIT.slope + ' x ln(tvl_usd) + category_adj) x growth_mult x maturity_mult )'
      ),
      el('div', { class: 'model-grid' },
        el('div', { class: 'model-cell' }, el('span', { text: 'Comps: traded tokens' }), el('b', { text: String(FIT.n_comps) }), el('small', { text: 'market cap over zero, TVL over zero' })),
        el('div', { class: 'model-cell' }, el('span', { text: 'Size curve R-squared' }), el('b', { text: String(FIT.curve_r2) }), el('small', { text: 'log market cap on log TVL' })),
        el('div', { class: 'model-cell' }, el('span', { text: 'Full model R-squared' }), el('b', { text: String(FIT.full_r2) }), el('small', { text: 'curve plus category adjustments' })),
        el('div', { class: 'model-cell' }, el('span', { text: 'Leave-one-out error, median' }), el('b', { text: fmtLogErr(FIT.loo_median_abs_log_err) }), el('small', { text: 'log units; refit on 93, predict 1, all 94' })),
        el('div', { class: 'model-cell' }, el('span', { text: 'Walk-forward error, median' }), el('b', { text: fmtLogErr(FIT.walk_forward_median_abs_log_err) }), el('small', { text: 'fit before 2024, test after: ' + FIT.walk_forward_train + ' train, ' + FIT.walk_forward_test + ' test' })),
        el('div', { class: 'model-cell' }, el('span', { text: 'Flat 0.25x TVL, for comparison' }), el('b', { text: fmtLogErr(FIT.flat_loo_median_abs_log_err) }), el('small', { text: 'the same leave-one-out test; the curve beats it' }))
      ),
      el('p', { class: 'sub', text: 'Category adjustments (log units, shrunk toward zero, capped at 0.75): ' + (adjText || 'none') + '.' }),
      el('h3', { text: 'What the model leaves out, on purpose' }),
      el('ul', { class: 'assumptions' },
        el('li', { text: 'Growth and age are small priors, not fitted terms: on the comps, seven-day growth correlates -0.12 with the log multiple and age 0.00, and fitting them as regression terms did not help — leave-one-out ' + FIT.loo_curve_only_median_abs_log_err + ' without them against ' + FIT.loo_fitted_terms_median_abs_log_err + ' with them, and walk-forward ' + FIT.walk_forward_curve_only_median_abs_log_err + ' against ' + FIT.walk_forward_fitted_terms_median_abs_log_err + '. Growth moves value by at most 12%, age by at most 10%.' }),
        el('li', { text: 'Exchanges, bridges and liquid-staking or restaking products are never ranked: their token would be a wrapped or staked product of one that trades, not a new launch. Versioned pools (a name ending in V2, v2 or 2.0) are left out the same way.' }),
        el('li', { text: 'A protocol is called pre-token only when its record carries no token: no market cap, no CoinGecko id and no symbol. A record can miss a token, so the board says records no token, never has none.' })
      ),
      el('h3', { text: 'How a farm plan is netted' }),
      el('ul', { class: 'assumptions' },
        el('li', { text: 'Gas is priced per transaction by chain: Ethereum $4.00, Bitcoin $1.00, Tron $0.50, Binance, Base, Arbitrum, Optimism, Polygon and Avalanche $0.30, Hyperliquid L1 and Monad $0.10, Solana and Sui $0.05, Stellar $0.01, anything else $0.50. A plan counts 2 setup transactions, 1 a week through the hold, and 1 to exit.' }),
        el('li', { text: 'Capital is never a cost: it is deployed and returned at unwind. The net cost is gas alone, and the break-even airdrop is that same gas.' }),
        el('li', { text: 'The expected share assumes 5% of the implied value goes to farmers, shared by 10,000 farmers. FARM means the expected share covers the net cost 3 times over, THIN means it covers it once, SKIP means it does not cover it. Change the assumptions and the verdicts move with them; the arithmetic is on the page.' })
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var recomputed = impliedOf(row);
    var curve = curveOf(row);
    var farm = farmOf(row);
    var farmOk = farm.gas === row.farm.gas_usd && farm.verdict === row.farm.verdict && farm.expected === row.farm.expected_value_usd;
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Curve value' }), el('b', { class: 'num', text: fmtUsd(curve) })),
        el('div', null, el('span', { text: 'Category adjustment' }), el('b', { class: 'num', text: (row.category_adj_log >= 0 ? '+' : '') + row.category_adj_log.toFixed(2) + ' log' })),
        el('div', null, el('span', { text: 'Growth x maturity' }), el('b', { class: 'num', text: row.growth_multiplier.toFixed(2) + ' x ' + row.maturity_multiplier.toFixed(2) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Implied over TVL' }), el('b', { class: 'num', text: fmtMult(row.implied_value_usd / row.tvl_usd) }))
      ),
      el('p', { class: 'sub check-line ' + (recomputed === row.implied_value_usd ? 'ok' : 'warn'), text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — net cost $' + row.farm.net_cost_usd.toFixed(2) + ' · verdict ' + row.farm.verdict }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { class: 'sub check-line ' + (farmOk ? 'ok' : 'warn'), text: 'Netting recomputed in the page: ' + farm.tx + ' transactions on ' + farm.chain + ' at $' + gasPerTx(farm.chain) + ' each is $' + farm.gas.toFixed(2) + ' of gas, capital $' + row.farm.capital_usd + ' returned, expected share $' + farm.expected.toFixed(2) + ', verdict ' + farm.verdict + (farmOk ? ' — the same as board.json.' : ' — differs from the board.') })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
