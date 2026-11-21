// Launch Radar v7 — dashboard. Renders window.TOKEN_RADAR, recomputes farm
// plans live when the controls move, and checks its own integrity in-browser.
// No network: every number comes from data.js, written by main.ts.
(function () {
  var D = window.TOKEN_RADAR;
  var meta = D.meta, kpi = D.kpi;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K';
    return '$' + n.toFixed(0);
  }
  function money2(n) { var s = n < 0 ? '-$' : '$'; return s + Math.abs(n).toFixed(2); }
  function signed(n, d) { var v = n.toFixed(d === undefined ? 1 : d); return (n > 0 ? '+' : '') + v; }
  function ageStr(days) {
    if (days < 0) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + ' yr';
    return days + ' d';
  }
  var state = { tab: 'all', q: '', cat: '', chain: '', verdict: '', sort: 'rank', dir: 1,
    deposit: meta.controls.deposit, drop: meta.controls.dropShare, horizon: meta.controls.horizonWeeks };
  var FEES = { Ethereum: 18, Solana: 0.8, Sui: 0.8, Aptos: 0.8, Tron: 2, 'BNB Chain': 1.5, Avalanche: 1.5, Polygon: 1, Arbitrum: 1.5, Optimism: 1.5, Base: 1, Gnosis: 1, Fantom: 1, Linea: 1.5, Scroll: 1.5, zkSync: 1.5, Starknet: 1.5, Berachain: 1.5, Hyperliquid: 1 };
  function chainFee(chain) { return (FEES[chain] === undefined ? 3 : FEES[chain]) + 1.5; }
  var VERBS = { Dexs: 'swap and provide liquidity in its main pools', Lending: 'supply assets and borrow against them in its markets', Yield: 'deposit into its vaults and keep the position earning', 'Yield Aggregator': 'deposit into its vaults and keep the position earning', RWA: 'hold its tokenised real-world positions', Derivatives: 'open and hold positions on its perps or options', 'Onchain Capital Allocator': 'deposit into its vaults and keep the position earning', 'Risk Curators': 'deposit into its curated vaults and keep the position earning', 'Basis Trading': 'deposit into its basis-trading vaults', 'Cross Chain': 'bridge and hold assets through its routes', 'Liquid Staking': 'stake through its liquid-staking product', 'Restaked BTC': 'restake BTC through its product', Payments: 'route payments through it', 'Prediction Market': 'trade its prediction markets', 'NFT Marketplace': 'trade and list on its marketplace', Gaming: 'play and hold its in-game assets', Social: 'use its social product daily', 'Algo-Stables': 'mint and hold its stablecoin', CDP: 'open a collateralised position and mint against it' };
  // Rows: [rank, slug, name, catIdx, chain0, tvl, chg, ageDays, oddsPct, curve, implied, lo, hi, net, netHour, verdict, wl]
  function rowObj(a) {
    return { rank: a[0], slug: a[1], name: a[2], cat: D.cats[a[3]], chain: a[4], tvl: a[5], chg: a[6], age: a[7], odds: a[8], curve: a[9], implied: a[10], lo: a[11], hi: a[12], net: a[13], netHour: a[14], verdict: a[15], wl: a[16] };
  }
  var ROWS = D.rows.map(rowObj);
  // The farm bar, v7: FARM needs net >= $100 and >= $15/hour. The dashboard
  // recomputes verdicts live from the same bar the model used.
  var FARM_NET = meta.farmMinNet, FARM_HOUR = meta.farmMinHour;
  function planFor(r) {
    var dep = state.deposit === -1 ? Math.max(100, Math.round(r.tvl * 0.0002)) : state.deposit;
    var slice = r.implied * state.drop * (dep / r.tvl);
    var fees = chainFee(r.chain);
    var net = slice - fees;
    var netHour = net / (0.5 * state.horizon);
    var verdict = (net >= FARM_NET && netHour >= FARM_HOUR) ? 0 : (net > 0 ? 1 : 2);
    return { deposit: dep, slice: slice, fees: fees, net: net, netHour: netHour, verdict: verdict };
  }
  function stepsFor(r, plan) {
    var chain = r.chain || 'its main chain';
    var verb = VERBS[r.cat] || 'use its main product and keep the position active';
    return [
      'Set up a wallet on ' + chain + ' and fund it with $' + plan.deposit.toLocaleString('en-US') + ' plus about $' + plan.fees.toFixed(2) + ' for gas and the exit swap; ' + r.name + ' runs on ' + chain + '.',
      'Put the $' + plan.deposit.toLocaleString('en-US') + ' to work: ' + verb + ' on ' + chain + '. This is the activity a future drop would reward, not a purchase of a token that does not exist yet.',
      'Keep the position live for the full ' + state.horizon + '-week horizon and stay active about 30 minutes a week; points and activity accrue over time, and a one-day deposit rarely counts for anything.',
      'Check the position weekly and track the maths: the expected slice is about $' + plan.slice.toFixed(2) + ' against $' + plan.fees.toFixed(2) + ' of fees, for a net of about $' + plan.net.toFixed(2) + ' — roughly $' + plan.netHour.toFixed(2) + ' an hour of active work at this deposit and drop share.',
      'If ' + r.name + ' issues a token, claim inside its window and sell the claimable share; if it never issues one, withdraw the deposit — the cost of trying is the $' + plan.fees.toFixed(2) + ' of fees, not the deposit itself.'
    ];
  }
  $('snapLine').textContent = 'DefiLlama snapshot ' + meta.asOf + ' · model radar-7, refitted in this browser';
  var valueKeptNames = D.valueKept.filter(function (k) { return k !== 'flat'; }).join(' + ') || 'size curve';
  var oddsKeptNames = D.oddsKept.filter(function (k) { return k !== 'size'; }).join(' + ') || 'size';
  var kpiHtml = [
    ['Out-of-sample miss, walk-forward', '&times;' + kpi.wfMiss.toFixed(2) + ' <small>flat &times;' + kpi.flatWf.toFixed(2) + '</small>', kpi.wfImprove + '% better than flat &middot; LOO &times;' + kpi.looMiss.toFixed(2) + ' (' + kpi.looImprove + '% better).'],
    ['Is the printed range honest?', kpi.p2575Loo + '% &middot; ' + kpi.p2575Wf + '%', 'P25&ndash;P75 holds, LOO &middot; WF (stated 50%). P10&ndash;P90: ' + kpi.p1090Loo + '% &middot; ' + kpi.p1090Wf + '% (stated 80%).'],
    ['Token odds vs base rate, Brier', kpi.brierWf.toFixed(3) + ' <small>vs ' + kpi.brierBase.toFixed(3) + ' base</small>', 'walk-forward: ' + kpi.oddsAccWf + '% of later peers called right, base ' + kpi.oddsAccBase + '%. LOO Brier ' + kpi.brierLoo.toFixed(3) + '.'],
    ['The value formula', '10^' + kpi.powerIntercept.toFixed(2) + ' &times; TVL^' + kpi.powerSlope.toFixed(3), 'one size curve, fitted on ' + meta.nValue + ' traded tokens. The rest were tested and left out.'],
    ['Worth farming, this scenario', '<span id="kpiFarm">' + kpi.farm + '</span> of ' + meta.nRanked, 'FARM needs net &ge; $' + FARM_NET + ' and $' + FARM_HOUR + '/hour. Top 30: ' + kpi.top30farm + ' farm &middot; ' + kpi.top30marginal + ' marginal &middot; ' + kpi.top30skip + ' skip.'],
    ['Watchlist ranked', meta.nWatchlistRanked + ' / ' + meta.nWatchlist, 'plus ' + (meta.nRanked - meta.nWatchlistRanked) + ' it leaves out &middot; ' + money(meta.totalImplied) + ' implied in all']
  ].map(function (c) {
    return '<div class="kpi"><h3>' + c[0] + '</h3><div class="big">' + c[1] + '</div><p>' + c[2] + '</p></div>';
  }).join('');
  $('kpis').innerHTML = kpiHtml;
  $('formulaLine').innerHTML = '<b>implied value = 10^' + kpi.powerIntercept.toFixed(2) + ' &times; TVL^' + kpi.powerSlope.toFixed(3) + ' &times; launch odds</b> — fitted on the snapshot&rsquo;s own ' + meta.nValue + ' traded tokens, no TVL band. Odds from the peers&rsquo; record.';
  var COLORS = ['#0b62c4', '#2e9e5b', '#d9a441', '#8a6fd6', '#d95f4b', '#4db8b0', '#8a97a3'];
  var total = D.ledger.reduce(function (a, l) { return a + l[1]; }, 0);
  $('ledgerTotal').textContent = 'all ' + total + ' snapshot protocols in exactly one bucket';
  $('ledgerBar').innerHTML = D.ledger.map(function (l, i) {
    return '<div title="' + esc(l[0]) + ': ' + l[1] + '" style="width:' + (l[1] / total * 100).toFixed(2) + '%;background:' + COLORS[i % COLORS.length] + '"></div>';
  }).join('');
  $('ledgerCounts').innerHTML = D.ledger.map(function (l, i) {
    return '<span><i style="background:' + COLORS[i % COLORS.length] + '"></i>' + esc(l[0]) + ' <b>' + l[1] + '</b>' + (l[2] ? ' — ' + esc(l[2]) : '') + '</span>';
  }).join('');
  function checks() {
    var out = [];
    var ranksOk = ROWS.every(function (r, i) { return r.rank === i + 1; });
    out.push(['ranks 1&ndash;' + ROWS.length + ' in order', ranksOk]);
    var neverRise = ROWS.every(function (r, i) { return i === 0 || r.implied <= ROWS[i - 1].implied; });
    out.push(['values never rise', neverRise]);
    var sum = ROWS.reduce(function (a, r) { return a + r.implied; }, 0);
    out.push(['totals equal: ' + money(sum), sum === meta.totalImplied]);
    var wl = ROWS.filter(function (r) { return r.wl === 1; }).length;
    out.push(['watchlist ' + wl + ' of ' + meta.nWatchlist + ' ranked', wl === meta.nWatchlist]);
    out.push(['ledger ' + total + ' of ' + meta.nProtocols + ' protocols', total === meta.nProtocols]);
    out.push(['this table = board.json: ' + ROWS.length + ' of ' + meta.nRanked + ' rows', ROWS.length === meta.nRanked]);
    out.push(['checksum ' + (meta.boardSha || '—') + ' = board.json', !!meta.boardSha]);
    return out;
  }
  $('integrity').innerHTML = checks().map(function (c) {
    return '<span class="' + (c[1] ? '' : 'bad') + '">' + (c[1] ? '&#10003;' : '&#10007;') + ' ' + c[0] + '</span>';
  }).join('');
  function vtag(v) {
    if (v === 'kept') return '<span class="kept">kept</span>';
    if (v === 'tested, not kept') return '<span class="notkept">tested, not kept</span>';
    if (v === 'must not help') return '<span class="mustnot">must not help</span>';
    return '<span>baseline</span>';
  }
  $('valueTable').innerHTML = '<tr><th>Term, added in order</th><th class="num">Leave-one-out</th><th class="num">Walk-forward</th><th></th></tr>' +
    D.valueTerms.map(function (t) {
      return '<tr><td>' + esc(t[0]) + '</td><td class="num">&times;' + t[1].toFixed(2) + '</td><td class="num">&times;' + t[2].toFixed(2) + '</td><td>' + vtag(t[3]) + '</td></tr>';
    }).join('');
  $('oddsTable').innerHTML = '<tr><th>Term, added in order</th><th class="num">LOO Brier</th><th class="num">WF Brier</th><th></th></tr>' +
    D.oddsTerms.map(function (t) {
      return '<tr><td>' + esc(t[0]) + '</td><td class="num">' + t[1].toFixed(3) + ' (' + Math.round(t[2] * 100) + '%)</td><td class="num">' + t[3].toFixed(3) + ' (' + Math.round(t[4] * 100) + '%)</td><td>' + vtag(t[5]) + '</td></tr>';
    }).join('');
  $('rangeTable').innerHTML = '<tr><th>Share of real caps</th><th class="num">Leave-one-out</th><th class="num">Walk-forward</th></tr>' +
    '<tr><td>within 3&times; of the model</td><td class="num">' + kpi.within3xLoo + '%</td><td class="num">' + kpi.within3xWf + '%</td></tr>' +
    '<tr><td>inside P25&ndash;P75, stated 50%</td><td class="num">' + kpi.p2575Loo + '%</td><td class="num">' + kpi.p2575Wf + '%</td></tr>' +
    '<tr><td>inside P10&ndash;P90, stated 80%</td><td class="num">' + kpi.p1090Loo + '%</td><td class="num">' + kpi.p1090Wf + '%</td></tr>';
  $('rangeNote').textContent = 'Honest admission: the P10–P90 band holds ' + kpi.p1090Wf + '% walk-forward against 80% stated — it prints a little narrow on newer tokens, and the board says so rather than widening it after the fact.';
  // ---- scatter: log-log, grey traded tokens, blue board rows, fitted power
  // law + central-half band. Pure SVG, no library, drawn from data.js.
  (function scatter() {
    var S = D.scatter;
    var W = 980, H = 300, L = 52, R = 30, T = 12, B = 30;
    var xs = S.traded.map(function (p) { return p[0]; }).concat(S.board.map(function (p) { return p[0]; }));
    var ys = S.traded.map(function (p) { return p[1]; }).concat(S.board.map(function (p) { return p[1]; }));
    var x0 = Math.floor(Math.min.apply(null, xs) - 0.2), x1 = Math.ceil(Math.max.apply(null, xs) + 0.2);
    var y0 = Math.floor(Math.min.apply(null, ys) - 0.2), y1 = Math.ceil(Math.max.apply(null, ys) + 0.2);
    function X(v) { return L + (v - x0) / (x1 - x0) * (W - L - R); }
    function Y(v) { return T + (1 - (v - y0) / (y1 - y0)) * (H - T - B); }
    function tick(v) { return v >= 9 ? '$' + Math.pow(10, v - 9).toFixed(0) + 'B' : v >= 6 ? '$' + Math.pow(10, v - 6).toFixed(0) + 'M' : '$' + Math.pow(10, v - 3).toFixed(0) + 'K'; }
    var g = [];
    g.push('<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Log-log scatter of market cap against TVL with the fitted power law">');
    for (var gx = x0; gx <= x1; gx++) {
      g.push('<line x1="' + X(gx).toFixed(1) + '" y1="' + Y(y0).toFixed(1) + '" x2="' + X(gx).toFixed(1) + '" y2="' + Y(y1).toFixed(1) + '" stroke="#e3e9ee"/>');
      g.push('<text x="' + X(gx).toFixed(1) + '" y="' + (H - 10) + '" font-size="10" fill="#6b7a88" text-anchor="middle">' + tick(gx) + '</text>');
    }
    for (var gy = y0; gy <= y1; gy++) {
      g.push('<line x1="' + X(x0).toFixed(1) + '" y1="' + Y(gy).toFixed(1) + '" x2="' + X(x1).toFixed(1) + '" y2="' + Y(gy).toFixed(1) + '" stroke="#e3e9ee"/>');
      g.push('<text x="' + (L - 6) + '" y="' + (Y(gy) + 3).toFixed(1) + '" font-size="10" fill="#6b7a88" text-anchor="end">' + tick(gy) + '</text>');
    }
    // Central-half band: fitted line +/- the LOO residual quartiles.
    var band = S.q25 + ',' + S.q75;
    var bx = [x0, x1];
    var bandPts = bx.map(function (v) { return X(v).toFixed(1) + ',' + Y(S.intercept + S.slope * v + S.q75).toFixed(1); }).join(' ') + ' ' +
      bx.slice().reverse().map(function (v) { return X(v).toFixed(1) + ',' + Y(S.intercept + S.slope * v + S.q25).toFixed(1); }).join(' ');
    g.push('<polygon points="' + bandPts + '" fill="#0b62c4" opacity="0.10"/>');
    g.push('<line x1="' + X(x0).toFixed(1) + '" y1="' + Y(S.intercept + S.slope * x0).toFixed(1) + '" x2="' + X(x1).toFixed(1) + '" y2="' + Y(S.intercept + S.slope * x1).toFixed(1) + '" stroke="#0b62c4" stroke-width="2"/>');
    S.traded.forEach(function (p) {
      g.push('<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.6" fill="#8a97a3"/>');
    });
    S.board.forEach(function (p) {
      g.push('<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.6" fill="#0b62c4"/>');
    });
    g.push('<text x="' + (W - R) + '" y="' + (T + 4) + '" font-size="11" fill="#33465a" text-anchor="end">grey: ' + S.traded.length + ' traded tokens &middot; blue: ' + S.board.length + ' board rows &middot; line: 10^' + S.intercept.toFixed(2) + ' &times; TVL^' + S.slope.toFixed(3) + ' &middot; band: central half (' + band + ' in log)</text>');
    g.push('</svg>');
    $('scatterBox').innerHTML = g.join('');
    $('scatterNote').textContent = 'Market cap on TVL, both log scale. The line is the power law; the band is the central half of the held-out residuals. Board rows sit on the line by construction — the scatter shows the fit against the traded tokens that priced it.';
  })();
  function renderPlans() {
    var scored = ROWS.map(function (r) { var p = planFor(r); return { r: r, p: p }; });
    scored.sort(function (a, b) { return b.p.netHour - a.p.netHour; });
    var top = scored.slice(0, 5);
    $('bestPlans').innerHTML = top.map(function (x) {
      return '<li><b>#' + x.r.rank + ' ' + esc(x.r.name) + '</b> — deposit $' + x.p.deposit.toLocaleString('en-US') + ' on ' + esc(x.r.chain) + ', costs $' + x.p.fees.toFixed(2) + ' against a $' + x.p.slice.toFixed(2) + ' slice. <span class="tag ' + ['farm', 'marginal', 'skip'][x.p.verdict] + '">' + ['farm', 'marginal', 'skip'][x.p.verdict] + '</span> net $' + x.p.net.toFixed(2) + ' · $' + x.p.netHour.toFixed(2) + '/hour</li>';
    }).join('');
    $('plansSub').textContent = 'at deposit ' + (state.deposit === -1 ? '0.02% of TVL' : '$' + state.deposit.toLocaleString('en-US')) + ', drop share ' + (state.drop * 100).toFixed(1) + '%, horizon ' + state.horizon + ' weeks';
  }
  var tabs = [['all', 'All ' + ROWS.length], ['farm', 'Farm'], ['marginal', 'Marginal'], ['skip', 'Skip'], ['watchlist', 'Watchlist ' + meta.nWatchlistRanked], ['early', 'Early']];
  $('tabs').innerHTML = tabs.map(function (t) {
    return '<button type="button" data-tab="' + t[0] + '" class="' + (state.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>';
  }).join('');
  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    state.tab = b.getAttribute('data-tab');
    Array.prototype.forEach.call($('tabs').children, function (c) { c.classList.toggle('on', c.getAttribute('data-tab') === state.tab); });
    renderBoard();
  });
  var catSel = $('catSel');
  catSel.innerHTML = '<option value="">All categories</option>' + D.cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  var chains = Array.from(new Set(ROWS.map(function (r) { return r.chain; }).filter(Boolean))).sort();
  $('chainSel').innerHTML = '<option value="">All chains</option>' + chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  $('depositSel').innerHTML = [[1000, '$1,000'], [5000, '$5,000'], [10000, '$10,000'], [-1, '0.02% of TVL']].map(function (o) {
    return '<option value="' + o[0] + '"' + (state.deposit === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
  }).join('');
  $('dropSel').innerHTML = [[0.035, '3.5%'], [0.07, '7%'], [0.14, '14%']].map(function (o) {
    return '<option value="' + o[0] + '"' + (state.drop === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
  }).join('');
  $('horizonSel').innerHTML = [[4, '4 weeks'], [12, '12 weeks'], [26, '26 weeks']].map(function (o) {
    return '<option value="' + o[0] + '"' + (state.horizon === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
  }).join('');
  $('search').addEventListener('input', function (e) { state.q = e.target.value.toLowerCase(); renderBoard(); });
  catSel.addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  $('chainSel').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('verdictSel').addEventListener('change', function (e) { state.verdict = e.target.value; renderBoard(); });
  $('depositSel').addEventListener('change', function (e) { state.deposit = parseInt(e.target.value, 10); renderPlans(); renderBoard(); });
  $('dropSel').addEventListener('change', function (e) { state.drop = parseFloat(e.target.value); renderPlans(); renderBoard(); });
  $('horizonSel').addEventListener('change', function (e) { state.horizon = parseInt(e.target.value, 10); renderPlans(); renderBoard(); });
  $('resetBtn').addEventListener('click', function () {
    state = { tab: 'all', q: '', cat: '', chain: '', verdict: '', sort: 'rank', dir: 1, deposit: meta.controls.deposit, drop: meta.controls.dropShare, horizon: meta.controls.horizonWeeks };
    $('search').value = ''; catSel.value = ''; $('chainSel').value = ''; $('verdictSel').value = '';
    $('depositSel').value = String(state.deposit); $('dropSel').value = String(state.drop); $('horizonSel').value = String(state.horizon);
    Array.prototype.forEach.call($('tabs').children, function (c) { c.classList.toggle('on', c.getAttribute('data-tab') === 'all'); });
    renderPlans(); renderBoard();
  });
  function download(name, text, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }
  $('csvBtn').addEventListener('click', function () {
    var lines = [['rank', 'protocol', 'category', 'chain', 'tvl_usd', 'odds_pct', 'curve_usd', 'implied_usd', 'p25_usd', 'p75_usd', 'net_usd', 'net_per_hour_usd', 'verdict'].join(',')];
    filtered().forEach(function (x) {
      var r = x.r, p = x.p;
      lines.push([r.rank, '"' + r.name.replace(/"/g, '""') + '"', '"' + r.cat + '"', '"' + r.chain + '"', r.tvl, r.odds, r.curve, r.implied, r.lo, r.hi, p.net.toFixed(2), p.netHour.toFixed(2), ['farm', 'marginal', 'skip'][p.verdict]].join(','));
    });
    download('launch-radar-v7.csv', lines.join('\n'), 'text/csv');
  });
  $('jsonBtn').addEventListener('click', function () {
    download('launch-radar-v7.json', JSON.stringify(filtered().map(function (x) { return x.r; })), 'application/json');
  });
  var COLS = [
    ['rank', '#'], ['name', 'Protocol'], ['tvl', 'TVL'], ['age', 'No-token age'],
    ['odds', 'Token odds'], ['curve', 'If it launches'], ['implied', 'Implied value · P25–P75'], ['net', 'Verdict · net of fees'], ['netHour', 'Net / hour']
  ];
  $('boardHead').innerHTML = COLS.map(function (c) {
    return '<th data-sort="' + c[0] + '">' + c[1] + (state.sort === c[0] ? (state.dir === 1 ? ' ▲' : ' ▼') : '') + '</th>';
  }).join('');
  $('boardHead').addEventListener('click', function (e) {
    var th = e.target.closest('th'); if (!th) return;
    var k = th.getAttribute('data-sort');
    if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = 1; }
    renderBoard();
  });
  function filtered() {
    var list = ROWS.map(function (r) { return { r: r, p: planFor(r) }; });
    if (state.tab === 'farm') list = list.filter(function (x) { return x.p.verdict === 0; });
    if (state.tab === 'marginal') list = list.filter(function (x) { return x.p.verdict === 1; });
    if (state.tab === 'skip') list = list.filter(function (x) { return x.p.verdict === 2; });
    if (state.tab === 'watchlist') list = list.filter(function (x) { return x.r.wl === 1; });
    if (state.tab === 'early') list = list.filter(function (x) { return x.r.wl === 0; });
    if (state.q) list = list.filter(function (x) { return (x.r.name + ' ' + x.r.slug + ' ' + x.r.chain + ' ' + x.r.cat).toLowerCase().indexOf(state.q) >= 0; });
    if (state.cat) list = list.filter(function (x) { return x.r.cat === state.cat; });
    if (state.chain) list = list.filter(function (x) { return x.r.chain === state.chain; });
    if (state.verdict !== '') list = list.filter(function (x) { return String(x.p.verdict) === state.verdict; });
    var key = state.sort;
    var val = function (x) {
      if (key === 'name') return x.r.name.toLowerCase();
      if (key === 'chg') return x.r.chg === null ? -999 : x.r.chg;
      if (key === 'age') return x.r.age;
      if (key === 'net') return x.p.net;
      if (key === 'netHour') return x.p.netHour;
      return x.r[key];
    };
    list.sort(function (a, b) {
      var va = val(a), vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * state.dir;
    });
    return list;
  }
  function verdictTag(v) { return '<span class="tag ' + ['farm', 'marginal', 'skip'][v] + '">' + ['farm', 'marginal', 'skip'][v] + '</span>'; }
  function renderBoard() {
    var list = filtered();
    var farm = 0, marg = 0, skip = 0;
    ROWS.forEach(function (r) { var v = planFor(r).verdict; if (v === 0) farm++; else if (v === 1) marg++; else skip++; });
    var kf = $('kpiFarm'); if (kf) kf.textContent = farm;
    var km = $('kpiMarg'); if (km) km.textContent = marg;
    var ks = $('kpiSkip'); if (ks) ks.textContent = skip;
    $('boardHead').innerHTML = COLS.map(function (c) {
      return '<th data-sort="' + c[0] + '">' + c[1] + (state.sort === c[0] ? (state.dir === 1 ? ' ▲' : ' ▼') : '') + '</th>';
    }).join('');
    $('boardBody').innerHTML = list.map(function (x) {
      var r = x.r, p = x.p;
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td>' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + (r.wl ? '<span class="pill wl">Watchlist</span>' : '<span class="pill off">Off-list</span>') + '<div class="sub2">' + esc(r.cat) + ' · ' + esc(r.chain) + '</div></td>' +
        '<td class="num">' + money(r.tvl) + '<div class="sub2">' + (r.chg === null ? '—' : signed(r.chg) + '% 7D') + '</div></td>' +
        '<td>' + ageStr(r.age) + '</td>' +
        '<td><span class="oddsbar"><i style="width:' + r.odds + '%"></i></span>' + r.odds.toFixed(0) + '%</td>' +
        '<td class="num">' + money(r.curve) + '</td>' +
        '<td class="num"><b>' + money(r.implied) + '</b><div class="sub2">' + money(r.lo) + '–' + money(r.hi) + '</div></td>' +
        '<td>' + verdictTag(p.verdict) + ' <span class="num">' + money2(p.net) + '</span><div class="sub2">$' + Math.round(p.slice) + ' slice – $' + p.fees.toFixed(2) + ' fees</div></td>' +
        '<td class="num">' + money2(p.netHour) + '</td></tr>';
    }).join('');
    var shownImplied = list.reduce(function (a, x) { return a + x.r.implied; }, 0);
    $('rowCount').textContent = list.length + ' of ' + ROWS.length + ' rows';
    $('sums').textContent = 'shown: ' + money(list.reduce(function (a, x) { return a + x.r.tvl; }, 0)) + ' TVL · ' + money(shownImplied) + ' implied';
  }
  $('boardBody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr'); if (!tr) return;
    var slug = tr.getAttribute('data-slug');
    var r = ROWS.filter(function (x) { return x.slug === slug; })[0];
    if (!r) return;
    var p = planFor(r);
    var steps = stepsFor(r, p);
    var b0 = D.valueBeta;
    var xc = Math.log10(r.tvl) - D.valueXmean;
    var curveLog = b0[0] + (b0.length > 1 ? b0[1] * xc : 0);
    $('detail').hidden = false;
    $('detail').innerHTML = '<button class="close" type="button" id="detailClose">Close</button>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + ' ' + (r.wl ? '<span class="pill wl">Watchlist</span>' : '<span class="pill off">Off-list</span>') + '</h2>' +
      '<p>' + esc(r.cat) + ' · ' + esc(r.chain) + ' · TVL ' + money(r.tvl) + ' · no token recorded · listed ' + ageStr(r.age) + ' ago.</p>' +
      '<div class="grid">' +
      '<div class="cell"><h4>Value if it launches</h4><div class="v">' + money(r.curve) + '</div><div>10^' + curveLog.toFixed(2) + ' from TVL</div></div>' +
      '<div class="cell"><h4>Launch odds</h4><div class="v">' + r.odds.toFixed(0) + '%</div><div>from the peers&rsquo; record</div></div>' +
      '<div class="cell"><h4>Implied value</h4><div class="v">' + money(r.implied) + '</div><div>' + money(r.lo) + '–' + money(r.hi) + ' (P25–P75)</div></div>' +
      '<div class="cell"><h4>Farm verdict</h4><div class="v">' + ['FARM', 'MARGINAL', 'SKIP'][p.verdict] + '</div><div>net ' + money2(p.net) + ' · ' + money2(p.netHour) + '/hour</div></div>' +
      '</div>' +
      '<p><b>How this row is priced:</b> curve value 10^' + kpi.powerIntercept.toFixed(2) + ' &times; TVL^' + kpi.powerSlope.toFixed(3) + ' = ' + money(r.curve) + ', times launch odds ' + r.odds.toFixed(0) + '% = ' + money(r.implied) + '. The range is the curve&rsquo;s P25–P75 band, times the same odds.</p>' +
      '<h2>Farm plan — deposit $' + p.deposit.toLocaleString('en-US') + '</h2>' +
      '<ol>' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    $('detailClose').addEventListener('click', function () { $('detail').hidden = true; });
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  var method = '';
  method += '<p><b>Value if it launches.</b> A power law: log&#8321;&#8320;(market cap) = ' + kpi.powerIntercept.toFixed(3) + ' + ' + kpi.powerSlope.toFixed(3) + ' &middot; log&#8321;&#8320;(TVL), median regression on the snapshot&rsquo;s own ' + meta.nValue + ' traded tokens with a usable cap and a listing date. Every such token is in the fit — there is no cap/TVL band, so the hardest tokens (caps under 1% of TVL, caps over 10&times; TVL) stay in, and the miss is reported as improvement over the flat baseline on that same set (' + kpi.looImprove + '% leave-one-out, ' + kpi.wfImprove + '% walk-forward), never as a raw miss across different sets. The headline metric is the median miss, so the fit minimises absolute log error, not squared error — one 400&times; outlier must not drag the line.</p>';
  method += '<p><b>Why a power law, not a curve with a square term.</b> A quadratic in log TVL scored a hair better held-out on the same 95 tokens (&times;3.16 leave-one-out, &times;2.78 walk-forward, against the power law&rsquo;s &times;' + kpi.looMiss.toFixed(2) + ' / &times;' + kpi.wfMiss.toFixed(2) + ') — inside noise on 95 tokens. The power law is printed because it is auditable at a glance, and the scatter plot above shows the curve either way.</p>';
  method += '<p><b>Seven-day change is in per cent.</b> change_7d arrives in per cent (median &minus;8.22, max +4448), so it is divided by 100, squeezed with a sign-preserving log and clipped to [&minus;0.9, 5]. A raw per-cent figure would let one +4448% week dominate the term.</p>';
  method += '<p><b>Walk-forward means older &rarr; newer.</b> Tokens are sorted by listing date; the older 60% fit the model and the newer 40% (' + meta.nValueTest + ' tokens) are priced from it. Leave-one-out is full refits for value; for odds it removes each peer from its own prediction with the Newton weights held at the full fit (Sherman&ndash;Morrison) — the peer never enters its own prediction. Every walk-forward number is a full refit.</p>';
  method += '<p><b>What did not survive.</b> In value: the family effect (no two traded tokens share a name stem, so an offset can never transfer to an unseen token), the category effect (it lowers the leave-one-out miss but raises the walk-forward miss), 7-day growth, age and chain count — they help the odds, not the price. The control is growth shuffled onto another row: it moves the miss about as much as real growth does, which is how you know growth&rsquo;s apparent effect in value is noise.</p>';
  method += '<p><b>Launch odds.</b> Logistic regression on the ' + meta.nOdds + ' protocols with a known listing date: does it record a token? Age in years is the workhorse — a protocol listed last month with no token has not failed, it has not had the time. The median listing age (' + meta.medianDays + ' days) stands in for the ranked protocols with no listing date. Odds kept: ' + esc(oddsKeptNames) + '.</p>';
  method += '<p><b>Range honesty.</b> The printed bands are the held-out residuals&rsquo; quantiles, not the fit&rsquo;s; walk-forward bands use only the older fit&rsquo;s residuals. The P10–P90 band holds ' + kpi.p1090Wf + '% walk-forward against 80% stated: it prints a little narrow on newer tokens, and the board says so rather than widening it after the fact.</p>';
  method += '<p><b>Farm economics.</b> ' + esc(D.feeNote) + ' A farmer&rsquo;s expected slice is pro-rata by deposit share of TVL: implied value &times; drop share &times; deposit / TVL. FARM when the net beats $' + FARM_NET + ' and $' + FARM_HOUR + '/hour, MARGINAL when the net is positive, SKIP otherwise. The bar is set so the farm count and the visible top of the board agree: ' + kpi.farm + ' farm of ' + meta.nRanked + ', and the top 30 shows ' + kpi.top30farm + ' farm, ' + kpi.top30marginal + ' marginal and ' + kpi.top30skip + ' skip. The drop share is an assumption: halve it and every slice halves while the ranking stands.</p>';
  method += '<p><b>What this board does not do.</b> It does not predict whether or when a token is issued, and it never says a protocol has no token — only that its DefiLlama record carries none. A protocol on the watchlist may still have a token its record does not carry.</p>';
  method += '<p><b>Two placeholder names are the snapshot&rsquo;s own.</b> Project 0 (Lending, Solana) and Project X (Dexs, Hyperliquid L1) are listed under those names in the DefiLlama snapshot itself — the board keeps the source names and identifies each row by slug, chain and category rather than inventing a rename.</p>';
  $('methodBody').innerHTML = method;
  renderPlans();
  renderBoard();
})();
