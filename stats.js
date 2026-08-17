(function () {
  const STATS_URL = "data/models-stats.json";
  const SIZE_MIN = 56;
  const SIZE_MAX = 140;
  const GRAY = "#cbd5e1";

  function fmtTons(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    if (v === 0) return "0";
    if (Math.abs(v) >= 1e6) return (v / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " млн т";
    if (Math.abs(v) >= 1e3) return (v / 1e3).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " тыс. т";
    return v.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " т";
  }

  function shortName(name) {
    if (!name) return "";
    if (name.length <= 10) return name;
    return name.slice(0, 8) + "…";
  }

  function donutSize(annual, maxAnnual) {
    if (!maxAnnual || maxAnnual <= 0 || !annual || annual <= 0) return SIZE_MIN;
    const ratio = Math.sqrt(annual / maxAnnual);
    return Math.round(SIZE_MIN + (SIZE_MAX - SIZE_MIN) * Math.min(1, Math.max(0, ratio)));
  }

  function polar(cx, cy, r, angle) {
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  }

  function arcPath(cx, cy, rOuter, rInner, a0, a1) {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = polar(cx, cy, rOuter, a0);
    const [x1, y1] = polar(cx, cy, rOuter, a1);
    const [x2, y2] = polar(cx, cy, rInner, a1);
    const [x3, y3] = polar(cx, cy, rInner, a0);
    return [
      `M ${x0} ${y0}`,
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1}`,
      `L ${x2} ${y2}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${x3} ${y3}`,
      "Z"
    ].join(" ");
  }

  function buildDonutSvg(field, size) {
    const cx = size / 2;
    const cy = size / 2;
    const rOuter = size / 2 - 2;
    const rInner = rOuter * 0.58;
    const segments = field.segments || [];
    const total = segments.reduce((s, seg) => s + (seg.count || 0), 0);
    const parts = [];

    if (total <= 0) {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${(rOuter + rInner) / 2}" fill="none" stroke="${GRAY}" stroke-width="${rOuter - rInner}" />`);
    } else {
      let angle = -Math.PI / 2;
      segments.forEach((seg) => {
        const share = (seg.count || 0) / total;
        if (share <= 0) return;
        const next = angle + share * Math.PI * 2;
        if (share >= 0.999) {
          parts.push(`<circle cx="${cx}" cy="${cy}" r="${(rOuter + rInner) / 2}" fill="none" stroke="${seg.color}" stroke-width="${rOuter - rInner}" />`);
        } else {
          parts.push(`<path d="${arcPath(cx, cy, rOuter, rInner, angle, next)}" fill="${seg.color}" />`);
        }
        angle = next;
      });
    }

    const centerText = total > 0
      ? String(field.candidateTotal ?? total)
      : shortName(field.name);
    const sub = total > 0 ? "" : "нет расчётов";
    const fontSize = size < 72 ? 11 : size < 100 ? 13 : 15;
    const subSize = Math.max(8, fontSize - 4);

    parts.push(`<text x="${cx}" y="${cy - (sub ? 4 : 0)}" text-anchor="middle" dominant-baseline="middle" fill="#0f172a" font-size="${fontSize}" font-weight="700">${centerText}</text>`);
    if (sub) {
      parts.push(`<text x="${cx}" y="${cy + 12}" text-anchor="middle" dominant-baseline="middle" fill="#94a3b8" font-size="${subSize}">${sub}</text>`);
    }

    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${parts.join("")}</svg>`;
  }

  function tooltipHtml(field) {
    const segs = (field.segments || [])
      .map((s) => `${s.label}: ${s.count || 0}`)
      .join(" · ");
    return [
      `<strong>${field.name}</strong>`,
      `Валовая год. добыча: ${fmtTons(field.annualTons)}`,
      `База (1 год): ${fmtTons(field.baseAnnual)}`,
      segs || "Сегменты: нет расчётов",
      `Кандидаты всего: ${field.candidateTotal ?? 0}`
    ].join("<br>");
  }

  function renderDoSection(doBlock) {
    const fields = doBlock.fields || [];
    const totalAnnual = fields.reduce((s, f) => s + (f.annualTons || 0), 0);
    const maxAnnual = Math.max(0, ...fields.map((f) => f.annualTons || 0));

    const cards = fields.map((field) => {
      const size = donutSize(field.annualTons || 0, maxAnnual);
      const empty = !(field.segments || []).some((s) => (s.count || 0) > 0);
      return `
        <article class="donut-card ${empty ? "is-empty" : ""}" style="--donut-size:${size}px" title="">
          <div class="donut-wrap">${buildDonutSvg(field, size)}</div>
          <div class="donut-name">${field.name}</div>
          <div class="donut-meta">${fmtTons(field.annualTons)}</div>
          <div class="donut-tip">${tooltipHtml(field)}</div>
        </article>
      `;
    }).join("");

    return `
      <section class="stats-do">
        <header class="stats-do-head">
          <h2>${doBlock.do}</h2>
          <div class="stats-do-total">Суммарная валовая годовая добыча: <b>${fmtTons(totalAnnual)}</b> · месторождений: <b>${fields.length}</b></div>
        </header>
        <div class="donut-grid">${cards}</div>
      </section>
    `;
  }

  async function initStats(root) {
    if (!root) return;
    root.innerHTML = `<div class="stats-loading">Загрузка статистики моделей…</div>`;
    try {
      const res = await fetch(STATS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const legend = `
        <div class="stats-legend">
          <span class="leg"><i style="background:#0ea5e9"></i>ДО</span>
          <span class="leg"><i style="background:#f59e0b"></i>СПекТР</span>
          <span class="leg"><i style="background:#22c55e"></i>УБД/прочее</span>
          <span class="leg"><i style="background:${GRAY}"></i>нет расчётов</span>
        </div>
      `;
      const updated = data.updated ? ` · обновлено ${data.updated}` : "";
      root.innerHTML = `
        <div class="stats-head">
          <div>
            <h1>Статистика моделей</h1>
            <p class="stats-sub">Кандидаты в переводы в ППД по месторождениям (ДО / СПекТР / УБД). Размер доната ∝ √(валовая годовая добыча) в пределах ДО${updated}</p>
          </div>
          ${legend}
        </div>
        ${(data.dos || []).map(renderDoSection).join("")}
      `;
    } catch (err) {
      root.innerHTML = `<div class="stats-error">Не удалось загрузить <code>${STATS_URL}</code>: ${err.message}. Откройте страницу через локальный сервер.</div>`;
    }
  }

  window.initModelsStats = initStats;
})();
