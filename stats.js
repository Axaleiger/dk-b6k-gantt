(function () {
  const STATS_URL = "data/models-stats.json";
  const COORDS_URL = "data/field-coords.json";
  const SIZE_MIN = 56;
  const SIZE_MAX = 140;
  const MAP_SIZE_MIN = 38;
  const MAP_SIZE_MAX = 78;
  const GRAY = "#cbd5e1";

  let mapInstance = null;
  let markerByName = new Map();

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

  function donutSize(annual, maxAnnual, min, max) {
    if (!maxAnnual || maxAnnual <= 0 || !annual || annual <= 0) return min;
    const ratio = Math.sqrt(annual / maxAnnual);
    return Math.round(min + (max - min) * Math.min(1, Math.max(0, ratio)));
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

  function buildDonutSvg(field, size, opts = {}) {
    const cx = size / 2;
    const cy = size / 2;
    const rOuter = size / 2 - 2;
    const rInner = rOuter * (opts.innerRatio || 0.58);
    const segments = field.segments || [];
    const total = segments.reduce((s, seg) => s + (seg.count || 0), 0);
    const parts = [];
    const stroke = opts.map ? `stroke="rgba(255,255,255,.85)" stroke-width="1.2"` : "";

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
          parts.push(`<path d="${arcPath(cx, cy, rOuter, rInner, angle, next)}" fill="${seg.color}" ${stroke} />`);
        }
        angle = next;
      });
    }

    const centerText = total > 0
      ? String(field.candidateTotal ?? total)
      : (opts.map ? "0" : shortName(field.name));
    const sub = total > 0 ? "" : (opts.map ? "" : "нет расчётов");
    const fontSize = size < 48 ? 9 : size < 72 ? 11 : size < 100 ? 13 : 16;
    const subSize = Math.max(8, fontSize - 4);
    const fill = opts.map ? "#fff" : "#0f172a";
    const shadow = opts.map ? `style="paint-order:stroke;stroke:#0f172a;stroke-width:2.4px"` : "";

    parts.push(`<text x="${cx}" y="${cy - (sub ? 4 : 0)}" text-anchor="middle" dominant-baseline="middle" fill="${fill}" font-size="${fontSize}" font-weight="700" ${shadow}>${centerText}</text>`);
    if (sub) {
      parts.push(`<text x="${cx}" y="${cy + 12}" text-anchor="middle" dominant-baseline="middle" fill="#94a3b8" font-size="${subSize}">${sub}</text>`);
    }

    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${parts.join("")}</svg>`;
  }

  function tooltipHtml(field, extra = "") {
    const segs = (field.segments || [])
      .map((s) => `${s.label}: ${s.count || 0}`)
      .join(" · ");
    return [
      `<strong>${field.name}</strong>${field.doName ? ` · ${field.doName}` : ""}`,
      extra,
      `Валовая год. добыча: ${fmtTons(field.annualTons)}`,
      segs || "Сегменты: нет расчётов",
      `Кандидаты всего: ${field.candidateTotal ?? 0}`
    ].filter(Boolean).join("<br>");
  }

  function flattenFields(data) {
    const list = [];
    (data.dos || []).forEach((block) => {
      (block.fields || []).forEach((field) => {
        list.push({ ...field, doName: block.do });
      });
    });
    return list;
  }

  function aggregate(fields) {
    const segs = { do: 0, spektr: 0, ubd: 0 };
    let annual = 0;
    let withCalc = 0;
    fields.forEach((f) => {
      annual += f.annualTons || 0;
      (f.segments || []).forEach((s) => {
        if (segs[s.key] != null) segs[s.key] += s.count || 0;
      });
      if ((f.candidateTotal || 0) > 0) withCalc += 1;
    });
    const candidateTotal = segs.do + segs.spektr + segs.ubd;
    return {
      name: "Все месторождения",
      annualTons: annual,
      candidateTotal,
      withCalc,
      fieldCount: fields.length,
      segments: [
        { key: "do", label: "ДО", count: segs.do, color: "#0ea5e9" },
        { key: "spektr", label: "СПекТР", count: segs.spektr, color: "#f59e0b" },
        { key: "ubd", label: "УБД/прочее", count: segs.ubd, color: "#22c55e" }
      ]
    };
  }

  function renderDoSection(doBlock, maxAnnual) {
    const fields = doBlock.fields || [];
    const totalAnnual = fields.reduce((s, f) => s + (f.annualTons || 0), 0);
    const localMax = maxAnnual || Math.max(0, ...fields.map((f) => f.annualTons || 0));
    const cards = fields.map((field) => {
      const size = donutSize(field.annualTons || 0, localMax, SIZE_MIN, SIZE_MAX);
      const empty = !(field.segments || []).some((s) => (s.count || 0) > 0);
      return `
        <article class="donut-card ${empty ? "is-empty" : ""}" data-field="${field.name}">
          <div class="donut-wrap">${buildDonutSvg(field, size)}</div>
          <div class="donut-name">${field.name}</div>
          <div class="donut-meta">${fmtTons(field.annualTons)}</div>
          <div class="donut-tip">${tooltipHtml({ ...field, doName: doBlock.do })}</div>
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

  function renderSummary(allFields, byDo) {
    const total = aggregate(allFields);
    const doCards = byDo.map((block) => {
      const agg = aggregate(block.fields || []);
      agg.name = block.do;
      return `
        <article class="summary-do">
          <div class="summary-do-donut">${buildDonutSvg(agg, 96)}</div>
          <div>
            <div class="summary-do-name">${block.do}</div>
            <div class="summary-do-meta">${(block.fields || []).length} м-р · ${fmtTons(agg.annualTons)}</div>
            <div class="summary-do-meta">кандидаты: ДО ${agg.segments[0].count} · СПекТР ${agg.segments[1].count} · УБД ${agg.segments[2].count}</div>
          </div>
        </article>
      `;
    }).join("");

    return `
      <section class="stats-summary">
        <div class="summary-main">
          ${buildDonutSvg(total, 168, { innerRatio: 0.62 })}
          <div class="summary-caption">Свод по всем м-р<br><b>${total.candidateTotal}</b> кандидатов ППД</div>
        </div>
        <div class="summary-kpis">
          <div class="kpi-card"><div class="kpi-val">${fmtTons(total.annualTons)}</div><div class="kpi-label">валовая год. добыча</div></div>
          <div class="kpi-card"><div class="kpi-val">${total.fieldCount}</div><div class="kpi-label">месторождений</div></div>
          <div class="kpi-card"><div class="kpi-val">${total.withCalc}</div><div class="kpi-label">м-р с расчётами Б6К</div></div>
          <div class="kpi-card"><div class="kpi-val">${total.candidateTotal}</div><div class="kpi-label">кандидаты ДО+СПекТР+УБД</div></div>
        </div>
        <div class="summary-dos">${doCards}</div>
      </section>
    `;
  }

  function spreadPositions(items) {
    const placed = [];
    const result = new Map();
    const sorted = [...items].sort((a, b) => b.size - a.size);
    sorted.forEach((item) => {
      let lat = item.lat;
      let lng = item.lng;
      const minSep = 0.22 + (item.size / 80) * 0.14;
      for (let attempt = 0; attempt < 36; attempt++) {
        const conflict = placed.some((p) => {
          const dist = Math.hypot(p.lat - lat, (p.lng - lng) * Math.cos((lat * Math.PI) / 180));
          return dist < minSep + 0.08;
        });
        if (!conflict) break;
        const a = attempt * 0.95 + item.name.length * 0.21;
        const step = 0.11 + attempt * 0.035;
        lat += Math.sin(a) * step;
        lng += Math.cos(a) * step * 1.25;
      }
      placed.push({ lat, lng });
      result.set(item.name, [lat, lng]);
    });
    return result;
  }

  function initMap(allFields, coordsIndex) {
    const el = document.getElementById("statsMap");
    if (!el || typeof L === "undefined") return;

    if (mapInstance) {
      mapInstance.remove();
      mapInstance = null;
    }

    const map = L.map(el, {
      center: [62.4, 75.6],
      zoom: 5,
      minZoom: 3,
      maxZoom: 10,
      maxBounds: [[41, 19], [82, 190]],
      maxBoundsViscosity: 0.7,
      worldCopyJump: false
    });
    mapInstance = map;
    markerByName = new Map();

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap, &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 12
    }).addTo(map);

    const maxAnnual = Math.max(0, ...allFields.map((f) => f.annualTons || 0));
    const items = allFields.map((field) => {
      const c = coordsIndex[field.name];
      return {
        ...field,
        lat: c ? c.lat : 61.5,
        lng: c ? c.lng : 73.5,
        hasCoord: Boolean(c),
        size: donutSize(field.annualTons || 0, maxAnnual, MAP_SIZE_MIN, MAP_SIZE_MAX)
      };
    });
    const positions = spreadPositions(items.filter((x) => x.hasCoord));

    items.forEach((field) => {
      if (!field.hasCoord) return;
      const [lat, lng] = positions.get(field.name) || [field.lat, field.lng];
      const meta = coordsIndex[field.name] || {};
      const html = `
        <div class="map-donut" style="width:${field.size}px;height:${field.size + 16}px">
          ${buildDonutSvg(field, field.size, { map: true, innerRatio: 0.55 })}
          <div class="map-donut-label">${field.name}</div>
        </div>
      `;
      const icon = L.divIcon({
        className: "map-donut-icon",
        html,
        iconSize: [field.size, field.size + 16],
        iconAnchor: [field.size / 2, field.size / 2]
      });
      const marker = L.marker([lat, lng], { icon, zIndexOffset: Math.round(field.annualTons || 0) / 1000 });
      marker.bindPopup(`
        <div class="map-popup">
          ${tooltipHtml(field, meta.region ? `Район: ${meta.region}` : "")}
        </div>
      `, { maxWidth: 280 });
      marker.addTo(map);
      markerByName.set(field.name, marker);
    });

    const located = items.filter((x) => x.hasCoord);
    const fieldBounds = located.length
      ? L.latLngBounds(located.map((f) => positions.get(f.name) || [f.lat, f.lng]))
      : null;
    if (fieldBounds) map.fitBounds(fieldBounds.pad(0.28));

    function syncLabels() {
      el.classList.toggle("map-labels-on", map.getZoom() >= 7);
    }
    map.on("zoomend", syncLabels);
    syncLabels();

    const ruBtn = document.getElementById("mapZoomRu");
    const fieldsBtn = document.getElementById("mapZoomFields");
    if (ruBtn) ruBtn.addEventListener("click", () => map.setView([64.5, 90], 3));
    if (fieldsBtn && fieldBounds) fieldsBtn.addEventListener("click", () => map.fitBounds(fieldBounds.pad(0.28)));

    const missing = items.filter((x) => !x.hasCoord);
    if (missing.length) {
      console.warn("Нет координат:", missing.map((x) => x.name));
    }

    setTimeout(() => map.invalidateSize(), 80);
  }

  async function initStats(root) {
    if (!root) return;
    root.innerHTML = `<div class="stats-loading">Загрузка статистики моделей…</div>`;
    try {
      const [statsRes, coordsRes] = await Promise.all([
        fetch(STATS_URL),
        fetch(COORDS_URL)
      ]);
      if (!statsRes.ok) throw new Error(`HTTP ${statsRes.status}`);
      const data = await statsRes.json();
      const coords = coordsRes.ok ? await coordsRes.json() : { fields: {} };
      const coordsIndex = coords.fields || {};
      const allFields = flattenFields(data);
      const legend = `
        <div class="stats-legend">
          <span class="leg"><i style="background:#0ea5e9"></i>ДО</span>
          <span class="leg"><i style="background:#f59e0b"></i>СПекТР</span>
          <span class="leg"><i style="background:#22c55e"></i>УБД/прочее</span>
          <span class="leg"><i style="background:${GRAY}"></i>нет расчётов</span>
        </div>
      `;
      const updated = data.updated ? ` · обновлено ${data.updated}` : "";
      const maxAnnual = Math.max(0, ...allFields.map((f) => f.annualTons || 0));

      root.innerHTML = `
        <div class="stats-head">
          <div>
            <h1>Статистика моделей</h1>
            <p class="stats-sub">Размер шайбы ∝ √(валовая годовая добыча). Секторы — кандидаты в ППД по расчётам Б6К (ДО / СПекТР / УБД). На карте — фактические районы месторождений${updated}</p>
          </div>
          ${legend}
        </div>
        ${renderSummary(allFields, data.dos || [])}
        <section class="stats-map-block">
          <header class="stats-do-head">
            <h2>Карта РФ</h2>
            <div class="stats-do-total">ННГ — Ноябрьск / Муравленко · СН-МНГ — Мегион, ЗУБ, Тайлаковское. Клик по карточке ниже — зум к м-р</div>
            <div class="map-toolbar">
              <button type="button" id="mapZoomRu">Вся РФ</button>
              <button type="button" id="mapZoomFields">К месторождениям</button>
            </div>
          </header>
          <div id="statsMap" class="stats-map"></div>
        </section>
        ${(data.dos || []).map((block) => renderDoSection(block, maxAnnual)).join("")}
      `;

      initMap(allFields, coordsIndex);
      root.querySelectorAll(".donut-card[data-field]").forEach((card) => {
        card.addEventListener("click", () => {
          const marker = markerByName.get(card.dataset.field);
          if (!marker || !mapInstance) return;
          mapInstance.flyTo(marker.getLatLng(), Math.max(mapInstance.getZoom(), 7), { duration: 0.6 });
          marker.openPopup();
          document.getElementById("statsMap")?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      });
    } catch (err) {
      root.innerHTML = `<div class="stats-error">Не удалось загрузить данные: ${err.message}. Откройте страницу через локальный сервер или GitHub Pages.</div>`;
    }
  }

  window.initModelsStats = initStats;
  window.invalidateStatsMap = function () {
    if (mapInstance) setTimeout(() => mapInstance.invalidateSize(), 40);
  };
})();
