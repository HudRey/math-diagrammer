import "./style.css";
import { create, all } from "mathjs";

const math = create(all, {});

// =====================
// Types
// =====================
type StyleSpec = {
  stroke: string;
  strokeWidth: number;
  background: string;
  fontFamily: string;
  fontSize: number;
};

type CartesianPayload = {
  size: number;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  minorStep: number;
  majorStep: number;
  labelStep: number;
  hideZeroLabel: boolean;
  showBorder: boolean;
  showAxes: boolean;
};

type PointSet = {
  enabled: boolean;
  label: string;
  pointsText: string;
  pointColor: string;
  pointRadius: number;
  connectInOrder: boolean;
  lineColor: string;
  lineWidth: number;
};

type SegmentSet = {
  enabled: boolean;
  label: string;
  segmentsText: string;
  color: string;
  width: number;
};

type EndpointStyle = "none" | "open" | "closed";

type FunctionLayer = {
  enabled: boolean;
  label: string;
  expr: string;
  color: string;
  width: number;
  samplesPerPixel: number;

  restrictDomain: boolean;
  domainMin: number;
  domainMax: number;

  showEndpoints: boolean;
  leftEndpoint: EndpointStyle;
  rightEndpoint: EndpointStyle;
  endpointRadius: number;
};

type Annotation = {
  id: string;
  text: string;
  x: number; // graph coords
  y: number; // graph coords
  color: string;
  fontSize: number;
  bold: boolean;
  clipToPlot: boolean;
};

// =====================
// State
// =====================
const style: StyleSpec = {
  stroke: "#000000",
  strokeWidth: 1.5,
  background: "#ffffff",
  fontFamily: "Arial, system-ui, sans-serif",
  fontSize: 14,
};

let grid: CartesianPayload = {
  size: 760,
  xmin: -10,
  xmax: 10,
  ymin: -10,
  ymax: 10,
  minorStep: 1,
  majorStep: 5,
  labelStep: 2,
  hideZeroLabel: true,
  showBorder: true,
  showAxes: true,
};

const MAX_FUNCS = 4;
const MAX_POINTSETS = 4;
const MAX_SEGSETS = 4;
const MAX_ANNOS = 8

let functions: FunctionLayer[] = [
  {
    enabled: true,
    label: "f₁",
    expr: "y = 2x + 3",
    color: "#000000",
    width: 2.5,
    samplesPerPixel: 1.5,
    restrictDomain: false,
    domainMin: -10,
    domainMax: 10,
    showEndpoints: true,
    leftEndpoint: "closed",
    rightEndpoint: "closed",
    endpointRadius: 6,
  },
  {
    enabled: true,
    label: "f₂",
    expr: "y = x^2 - 4",
    color: "#000000",
    width: 2.5,
    samplesPerPixel: 1.5,
    restrictDomain: false,
    domainMin: -10,
    domainMax: 10,
    showEndpoints: true,
    leftEndpoint: "open",
    rightEndpoint: "open",
    endpointRadius: 6,
  },
];

let pointSets: PointSet[] = [
  {
    enabled: true,
    label: "Points A",
    pointsText: `(-6, 2)
(-2, 5)
(0, 0)
(3, -4)
(7, 6)`,
    pointColor: "#000000",
    pointRadius: 4,
    connectInOrder: false,
    lineColor: "#000000",
    lineWidth: 2,
  },
];

let segmentSets: SegmentSet[] = [
  {
    enabled: false,
    label: "Segments A",
    segmentsText: `(-8,-8)->(8,8)
(-8,8)->(8,-8)`,
    color: "#000000",
    width: 2,
  },
];

let annotations: Annotation[] = [
  {
    id: "a1",
    text: "Label",
    x: 0,
    y: 0,
    color: "#000000",
    fontSize: 18,
    bold: true,
    clipToPlot: true,
  },
];

// =====================
// Utils
// =====================
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function stripZero(n: number): string {
  const s = n.toFixed(10);
  return s.replace(/\.?0+$/, "");
}

function escapeXml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(`"`, "&quot;")
    .replaceAll("'", "&apos;");
}

function parsePoints(text: string): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const nums = line.match(/-?\d*\.?\d+(?:e-?\d+)?/gi);
    if (!nums || nums.length < 2) continue;
    const x = Number(nums[0]);
    const y = Number(nums[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
  }
  return pts;
}

function parseSegments(text: string): { a: { x: number; y: number }; b: { x: number; y: number } }[] {
  const segs: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const nums = line.match(/-?\d*\.?\d+(?:e-?\d+)?/gi);
    if (!nums || nums.length < 4) continue;
    const x1 = Number(nums[0]),
      y1 = Number(nums[1]),
      x2 = Number(nums[2]),
      y2 = Number(nums[3]);
    if ([x1, y1, x2, y2].every(Number.isFinite)) segs.push({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });
  }
  return segs;
}

function normalizeExpr(expr: string): string {
  return expr.trim().replace(/^\s*y\s*=\s*/i, "").trim();
}

// mild help for "2x" -> "2*x"
function softenImplicitMultiplication(s: string): string {
  return s
    .replace(/(\d)\s*x\b/gi, "$1*x")
    .replace(/(\d)\s*\(/g, "$1*(")
    .replace(/\)\s*x\b/gi, ")*x")
    .replace(/x\s*\(/gi, "x*(");
}

const compiledCache = new Map<string, any>();
function compileExpr(expr: string) {
  const norm = normalizeExpr(expr);
  if (!norm) throw new Error("Function expression is empty.");
  const softened = softenImplicitMultiplication(norm);
  if (compiledCache.has(softened)) return compiledCache.get(softened);
  const compiled = math.compile(softened);
  compiledCache.set(softened, compiled);
  return compiled;
}

// =====================
// Mapping
// =====================
function makeMapper(g: CartesianPayload) {
  const pad = Math.round(g.size * 0.08);
  const inner = g.size - pad * 2;

  const sx = inner / (g.xmax - g.xmin);
  const sy = inner / (g.ymax - g.ymin);

  const X = (x: number) => pad + (x - g.xmin) * sx;
  const Y = (y: number) => pad + inner - (y - g.ymin) * sy;

  const invX = (px: number) => g.xmin + (px - pad) / sx;
  const invY = (py: number) => g.ymin + (inner - (py - pad)) / sy;

  return { pad, inner, sx, sy, X, Y, invX, invY };
}

// =====================
// Rendering
// =====================
function renderCartesian(
  g: CartesianPayload,
  s: StyleSpec,
  overlaysClipped: string[],
  overlaysClippedTop: string[],
  overlaysFree: string[]
): string {
  const { size, xmin, xmax, ymin, ymax, minorStep, majorStep, labelStep, hideZeroLabel, showBorder, showAxes } = g;
  if (!(xmax > xmin) || !(ymax > ymin)) throw new Error("Ranges must satisfy xmax > xmin and ymax > ymin.");
  if (minorStep <= 0 || majorStep <= 0 || labelStep <= 0) throw new Error("Steps must be > 0.");

  const { pad, inner, X, Y } = makeMapper(g);
  const clipId = "plotClip";

  const gridLines: string[] = [];

  // Vertical grid
  const startX = Math.ceil(xmin / minorStep) * minorStep;
  for (let x = startX; x <= xmax + 1e-9; x += minorStep) {
    const isMajor = Math.abs(x / majorStep - Math.round(x / majorStep)) < 1e-9;
    const w = isMajor ? s.strokeWidth * 1.2 : s.strokeWidth * 0.6;
    const op = isMajor ? 0.9 : 0.35;
    gridLines.push(
      `<line x1="${X(x)}" y1="${Y(ymin)}" x2="${X(x)}" y2="${Y(ymax)}" stroke="${s.stroke}" stroke-width="${w}" opacity="${op}" />`
    );
  }

  // Horizontal grid
  const startY = Math.ceil(ymin / minorStep) * minorStep;
  for (let y = startY; y <= ymax + 1e-9; y += minorStep) {
    const isMajor = Math.abs(y / majorStep - Math.round(y / majorStep)) < 1e-9;
    const w = isMajor ? s.strokeWidth * 1.2 : s.strokeWidth * 0.6;
    const op = isMajor ? 0.9 : 0.35;
    gridLines.push(
      `<line x1="${X(xmin)}" y1="${Y(y)}" x2="${X(xmax)}" y2="${Y(y)}" stroke="${s.stroke}" stroke-width="${w}" opacity="${op}" />`
    );
  }

  // Axes
  const axes: string[] = [];
  if (showAxes) {
    const axisW = s.strokeWidth * 2.2;
    if (0 >= xmin && 0 <= xmax) {
      axes.push(
        `<line x1="${X(0)}" y1="${Y(ymin)}" x2="${X(0)}" y2="${Y(ymax)}" stroke="${s.stroke}" stroke-width="${axisW}" opacity="1" />`
      );
    }
    if (0 >= ymin && 0 <= ymax) {
      axes.push(
        `<line x1="${X(xmin)}" y1="${Y(0)}" x2="${X(xmax)}" y2="${Y(0)}" stroke="${s.stroke}" stroke-width="${axisW}" opacity="1" />`
      );
    }
  }

  // Labels
  const labels: string[] = [];
  const font = s.fontFamily;
  const fs = s.fontSize;

  const xLabelY = showAxes && 0 >= ymin && 0 <= ymax ? Y(0) : Y(ymin);
  const yLabelX = showAxes && 0 >= xmin && 0 <= xmax ? X(0) : X(xmin);

  const startXL = Math.ceil(xmin / labelStep) * labelStep;
  for (let x = startXL; x <= xmax + 1e-9; x += labelStep) {
    if (hideZeroLabel && Math.abs(x) < 1e-12) continue;
    labels.push(
      `<text x="${X(x)}" y="${xLabelY + fs + 6}" text-anchor="middle" font-family="${font}" font-size="${fs}" fill="${s.stroke}">${stripZero(
        x
      )}</text>`
    );
  }

  const startYL = Math.ceil(ymin / labelStep) * labelStep;
  for (let y = startYL; y <= ymax + 1e-9; y += labelStep) {
    if (hideZeroLabel && Math.abs(y) < 1e-12) continue;
    labels.push(
      `<text x="${yLabelX - 8}" y="${Y(y) + fs / 2 - 2}" text-anchor="end" font-family="${font}" font-size="${fs}" fill="${s.stroke}">${stripZero(
        y
      )}</text>`
    );
  }

  const border = showBorder
    ? `<rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" fill="none" stroke="${s.stroke}" stroke-width="${s.strokeWidth}" />`
    : "";

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <clipPath id="${clipId}">
      <rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" />
    </clipPath>
  </defs>

  <rect width="100%" height="100%" fill="${s.background}" />

  ${gridLines.join("\n")}

  <g clip-path="url(#${clipId})">
    ${overlaysClipped.join("\n")}
  </g>

  ${axes.join("\n")}
  ${border}
  ${labels.join("\n")}

  <g clip-path="url(#${clipId})">
    ${overlaysClippedTop.join("\n")}
  </g>

  ${overlaysFree.join("\n")}
</svg>`.trim();
}

// =====================
// Overlays
// =====================
function endpointCircle(
  px: number,
  py: number,
  r: number,
  mode: EndpointStyle,
  strokeColor: string,
  strokeW: number,
  bg: string
): string | null {
  if (mode === "none") return null;

  if (mode === "open") {
    return `<circle cx="${px}" cy="${py}" r="${r}" fill="${bg}" stroke="${strokeColor}" stroke-width="${strokeW}" />`;
  }

  return `<circle cx="${px}" cy="${py}" r="${r}" fill="${strokeColor}" stroke="${strokeColor}" stroke-width="${strokeW}" />`;
}

function overlayFunctions(g: CartesianPayload, layers: FunctionLayer[], bgColor: string): string[] {
  const out: string[] = [];
  const { inner, X, Y } = makeMapper(g);

  const fullWidth = g.xmax - g.xmin;
  const baseSamples = Math.max(250, inner);

  for (const f of layers) {
    if (!f.enabled) continue;

    let xStart = g.xmin;
    let xEnd = g.xmax;

    if (f.restrictDomain) {
      const dMin = Math.min(f.domainMin, f.domainMax);
      const dMax = Math.max(f.domainMin, f.domainMax);
      xStart = Math.max(g.xmin, dMin);
      xEnd = Math.min(g.xmax, dMax);
    }

    if (!(xEnd > xStart)) continue;

    const domainWidth = xEnd - xStart;
    const domainFrac = domainWidth / fullWidth;

    const samples = Math.max(140, Math.floor(baseSamples * f.samplesPerPixel * domainFrac));
    const dx = domainWidth / (samples - 1);
    const compiled = compileExpr(f.expr);

    const jumpThreshold = (g.ymax - g.ymin) * 2.5;

    let path = "";
    let penDown = false;
    let prevY: number | null = null;

    for (let i = 0; i < samples; i++) {
      const x = xStart + i * dx;

      let y: number;
      try {
        const v = compiled.evaluate({ x });
        y = typeof v === "number" ? v : Number(v);
      } catch {
        y = NaN;
      }

      const finite = Number.isFinite(y);
      const inYRange = finite && y >= g.ymin && y <= g.ymax;

      const bigJump =
        prevY !== null && inYRange && Number.isFinite(prevY) && Math.abs(y - prevY) > jumpThreshold;

      if (!inYRange || bigJump) {
        penDown = false;
        prevY = inYRange ? y : null;
        continue;
      }

      path += `${penDown ? "L" : "M"} ${X(x)} ${Y(y)} `;
      penDown = true;
      prevY = y;
    }

    if (path.trim()) {
      out.push(`<path d="${path.trim()}" fill="none" stroke="${f.color}" stroke-width="${f.width}" />`);
    }

    if (f.restrictDomain && f.showEndpoints) {
      const strokeW = Math.max(1, Math.min(8, f.width));

      // left endpoint
      {
        let y: number = NaN;
        try {
          const v = compiled.evaluate({ x: xStart });
          y = typeof v === "number" ? v : Number(v);
        } catch {
          y = NaN;
        }
        if (Number.isFinite(y) && y >= g.ymin && y <= g.ymax) {
          const c = endpointCircle(X(xStart), Y(y), f.endpointRadius, f.leftEndpoint, f.color, strokeW, bgColor);
          if (c) out.push(c);
        }
      }

      // right endpoint
      {
        let y: number = NaN;
        try {
          const v = compiled.evaluate({ x: xEnd });
          y = typeof v === "number" ? v : Number(v);
        } catch {
          y = NaN;
        }
        if (Number.isFinite(y) && y >= g.ymin && y <= g.ymax) {
          const c = endpointCircle(X(xEnd), Y(y), f.endpointRadius, f.rightEndpoint, f.color, strokeW, bgColor);
          if (c) out.push(c);
        }
      }
    }
  }

  return out;
}

function overlayPointSets(g: CartesianPayload, sets: PointSet[]): string[] {
  const out: string[] = [];
  const { X, Y } = makeMapper(g);

  for (const s of sets) {
    if (!s.enabled) continue;

    const pts = parsePoints(s.pointsText);
    if (pts.length === 0) continue;

    if (s.connectInOrder && pts.length >= 2) {
      const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${X(p.x)} ${Y(p.y)}`).join(" ");
      out.push(`<path d="${d}" fill="none" stroke="${s.lineColor}" stroke-width="${s.lineWidth}" />`);
    }

    for (const p of pts) {
      out.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${s.pointRadius}" fill="${s.pointColor}" />`);
    }
  }

  return out;
}

function overlaySegmentSets(g: CartesianPayload, sets: SegmentSet[]): string[] {
  const out: string[] = [];
  const { X, Y } = makeMapper(g);

  for (const s of sets) {
    if (!s.enabled) continue;

    const segs = parseSegments(s.segmentsText);
    if (segs.length === 0) continue;

    for (const seg of segs) {
      out.push(
        `<line x1="${X(seg.a.x)}" y1="${Y(seg.a.y)}" x2="${X(seg.b.x)}" y2="${Y(seg.b.y)}" stroke="${s.color}" stroke-width="${s.width}" />`
      );
    }
  }

  return out;
}

function overlayAnnotations(g: CartesianPayload, annos: Annotation[]) {
  const { X, Y } = makeMapper(g);
  const clipped: string[] = [];
  const free: string[] = [];

  for (const a of annos) {
    const px = X(a.x);
    const py = Y(a.y);

    const weight = a.bold ? "700" : "400";
    const txt = escapeXml(a.text);

    const node = `<text
      data-anno-id="${a.id}"
      x="${px}"
      y="${py}"
      fill="${a.color}"
      font-size="${a.fontSize}"
      font-family="${style.fontFamily}"
      font-weight="${weight}"
      dominant-baseline="middle"
      text-anchor="middle"
    >${txt}</text>`;

    (a.clipToPlot ? clipped : free).push(node);
  }

  return { clipped, free };
}

// =====================
// UI helpers
// =====================
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  return node;
}

function makeNumberInput(labelText: string, get: () => number, set: (v: number) => void, step = 1) {
  const wrap = el("div");
  const label = el("label");
  label.textContent = labelText;

  const input = el("input") as HTMLInputElement;
  input.type = "number";
  input.step = String(step);
  input.value = String(get());

  input.oninput = () => {
    set(Number(input.value));
    rerender();
  };

  wrap.append(label, input);
  return wrap;
}

function makeCheckbox(labelText: string, get: () => boolean, set: (v: boolean) => void) {
  const wrap = el("div");
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.gap = "8px";

  const input = el("input") as HTMLInputElement;
  input.type = "checkbox";
  input.checked = get();

  input.onchange = () => {
    set(input.checked);
    rerender();
  };

  const label = el("label");
  label.textContent = labelText;
  label.style.marginTop = "0";

  wrap.append(input, label);
  return wrap;
}

function makeColorInput(labelText: string, get: () => string, set: (v: string) => void) {
  const wrap = el("div");
  const label = el("label");
  label.textContent = labelText;

  const input = el("input") as HTMLInputElement;
  input.type = "color";
  input.value = get();

  input.oninput = () => {
    set(input.value);
    rerender();
  };

  wrap.append(label, input);
  return wrap;
}

function makeTextarea(labelText: string, get: () => string, set: (v: string) => void, rows = 6) {
  const wrap = el("div");
  const label = el("label");
  label.textContent = labelText;

  const ta = el("textarea") as HTMLTextAreaElement;
  ta.rows = rows;
  ta.value = get();

  ta.oninput = () => {
    set(ta.value);
    rerender();
  };

  wrap.append(label, ta);
  return wrap;
}

function makeTextInput(labelText: string, get: () => string, set: (v: string) => void) {
  const wrap = el("div");
  const label = el("label");
  label.textContent = labelText;

  const input = el("input") as HTMLInputElement;
  input.type = "text";
  input.value = get();

  input.oninput = () => {
    set(input.value);
    rerender();
  };

  wrap.append(label, input);
  return wrap;
}

function makeSelect<T extends string>(
  labelText: string,
  options: { value: T; label: string }[],
  get: () => T,
  set: (v: T) => void
) {
  const wrap = el("div");
  const label = el("label");
  label.textContent = labelText;

  const sel = el("select") as HTMLSelectElement;
  sel.style.width = "100%";
  sel.style.boxSizing = "border-box";
  sel.style.borderRadius = "10px";
  sel.style.border = "1px solid #ccc";
  sel.style.padding = "8px";
  sel.style.marginTop = "6px";
  sel.style.background = "#fff";

  for (const opt of options) {
    const o = el("option") as HTMLOptionElement;
    o.value = opt.value;
    o.textContent = opt.label;
    sel.appendChild(o);
  }

  sel.value = get();

  sel.onchange = () => {
    set(sel.value as T);
    rerender();
  };

  wrap.append(label, sel);
  return wrap;
}

function makeSection(title: string, open = false) {
  const details = el("details") as HTMLDetailsElement;
  details.open = open;

  const summary = el("summary");
  summary.textContent = title;

  const body = el("div");
  body.className = "sectionBody";

  details.append(summary, body);
  return { details, body };
}

function miniButton(text: string, onClick: () => void) {
  const b = el("button") as HTMLButtonElement;
  b.textContent = text;
  b.onclick = (e) => {
    e.preventDefault();
    onClick();
  };
  b.style.width = "auto";
  b.style.display = "inline-block";
  b.style.marginTop = "8px";
  b.style.padding = "6px 10px";
  return b;
}

function rowWrap() {
  const d = el("div");
  d.style.border = "1px solid #e3e3e3";
  d.style.borderRadius = "10px";
  d.style.padding = "10px";
  d.style.background = "#fff";
  d.style.marginTop = "10px";
  return d;
}

// =====================
// App layout
// =====================
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app element");

app.innerHTML = `
  <div class="layout">
    <div class="panel" style="width: 460px;">
      <h3>Graph Builder</h3>
      <p class="sub">Domain restrictions + endpoints + draggable annotations.</p>
      <div id="controls"></div>
      <div id="err" class="err"></div>
      <button id="dlSvg">Download SVG</button>
      <button id="dlPng">Download PNG</button>
    </div>

    <div class="previewWrap">
      <div id="preview" class="preview"></div>
    </div>
  </div>
`;

const controls = document.getElementById("controls") as HTMLDivElement;
const previewEl = document.getElementById("preview") as HTMLDivElement;
const errEl = document.getElementById("err") as HTMLDivElement;

const secGrid = makeSection("Grid", true);
const secFn = makeSection("Functions", true);
const secPoints = makeSection("Point Sets", false);
const secSegs = makeSection("Segment Sets", false);
const secAnno = makeSection("Annotations", false);

controls.append(secGrid.details, secFn.details, secPoints.details, secSegs.details, secAnno.details);

// Grid controls
secGrid.body.append(
  makeNumberInput("Image size (px)", () => grid.size, (v) => (grid.size = v), 10),
  makeNumberInput("x min", () => grid.xmin, (v) => (grid.xmin = v), 1),
  makeNumberInput("x max", () => grid.xmax, (v) => (grid.xmax = v), 1),
  makeNumberInput("y min", () => grid.ymin, (v) => (grid.ymin = v), 1),
  makeNumberInput("y max", () => grid.ymax, (v) => (grid.ymax = v), 1),
  makeNumberInput("Minor grid step", () => grid.minorStep, (v) => (grid.minorStep = v), 0.5),
  makeNumberInput("Major grid step", () => grid.majorStep, (v) => (grid.majorStep = v), 1),
  makeNumberInput("Label every (units)", () => grid.labelStep, (v) => (grid.labelStep = v), 1),
  makeCheckbox("Hide 0 label", () => grid.hideZeroLabel, (v) => (grid.hideZeroLabel = v)),
  makeCheckbox("Show axes", () => grid.showAxes, (v) => (grid.showAxes = v)),
  makeCheckbox("Show border", () => grid.showBorder, (v) => (grid.showBorder = v)),
  makeColorInput("Grid/axis color", () => style.stroke, (v) => (style.stroke = v)),
  makeColorInput("Background", () => style.background, (v) => (style.background = v))
);

// =====================
// Dynamic UIs
// =====================
const endpointOptions: { value: EndpointStyle; label: string }[] = [
  { value: "none", label: "None" },
  { value: "open", label: "Open (hollow)" },
  { value: "closed", label: "Closed (filled)" },
];

function rebuildFunctionUI() {
  secFn.body.innerHTML = "";

  const topBar = el("div");
  topBar.style.display = "flex";
  topBar.style.gap = "8px";
  topBar.style.flexWrap = "wrap";

  topBar.append(
    miniButton(`+ Add function (${functions.length}/${MAX_FUNCS})`, () => {
      if (functions.length >= MAX_FUNCS) return;
      const idx = functions.length + 1;
      functions.push({
        enabled: true,
        label: `f${idx}`,
        expr: "y = x",
        color: "#000000",
        width: 2.5,
        samplesPerPixel: 1.5,
        restrictDomain: false,
        domainMin: grid.xmin,
        domainMax: grid.xmax,
        showEndpoints: true,
        leftEndpoint: "closed",
        rightEndpoint: "closed",
        endpointRadius: 6,
      });
      rebuildFunctionUI();
      rerender();
    })
  );

  const hint = el("div");
  hint.style.fontSize = "12px";
  hint.style.color = "#444";
  hint.style.marginTop = "6px";
  hint.innerHTML =
    `Examples: <code>y = 2x+3</code>, <code>y = x^2 - 4</code>, <code>y = (x+1)/(x-2)</code>, <code>y = sin(x)</code>`;

  secFn.body.append(topBar, hint);

  functions.forEach((f, i) => {
    const box = rowWrap();

    const header = el("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";

    const left = el("div");
    left.style.fontWeight = "700";
    left.textContent = f.label;

    const rm = miniButton("Remove", () => {
      functions.splice(i, 1);
      rebuildFunctionUI();
      rerender();
    });
    rm.disabled = functions.length <= 1;

    header.append(left, rm);
    box.append(header);

    box.append(
      makeCheckbox("Enabled", () => f.enabled, (v) => (f.enabled = v)),
      makeTextInput("y =", () => f.expr, (v) => (f.expr = v)),
      makeColorInput("Color", () => f.color, (v) => (f.color = v)),
      makeNumberInput("Width", () => f.width, (v) => (f.width = v), 0.5),
      makeNumberInput("Smoothness (samples per pixel)", () => f.samplesPerPixel, (v) => (f.samplesPerPixel = v), 0.1),

      makeCheckbox("Restrict domain (x-range)", () => f.restrictDomain, (v) => (f.restrictDomain = v)),
      makeNumberInput("Domain x min", () => f.domainMin, (v) => (f.domainMin = v), 0.5),
      makeNumberInput("Domain x max", () => f.domainMax, (v) => (f.domainMax = v), 0.5),

      makeCheckbox("Show endpoints (only when domain restricted)", () => f.showEndpoints, (v) => (f.showEndpoints = v)),
      makeSelect("Left endpoint", endpointOptions, () => f.leftEndpoint, (v) => (f.leftEndpoint = v)),
      makeSelect("Right endpoint", endpointOptions, () => f.rightEndpoint, (v) => (f.rightEndpoint = v)),
      makeNumberInput("Endpoint radius (px)", () => f.endpointRadius, (v) => (f.endpointRadius = v), 1)
    );

    secFn.body.append(box);
  });
}

function rebuildPointsUI() {
  secPoints.body.innerHTML = "";

  secPoints.body.append(
    miniButton(`+ Add point set (${pointSets.length}/${MAX_POINTSETS})`, () => {
      if (pointSets.length >= MAX_POINTSETS) return;
      const idx = pointSets.length + 1;
      pointSets.push({
        enabled: true,
        label: `Points ${String.fromCharCode(64 + idx)}`,
        pointsText: `(0,0)\n(1,1)\n(2,3)`,
        pointColor: "#000000",
        pointRadius: 4,
        connectInOrder: false,
        lineColor: "#000000",
        lineWidth: 2,
      });
      rebuildPointsUI();
      rerender();
    })
  );

  pointSets.forEach((p, i) => {
    const box = rowWrap();

    const header = el("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";

    const left = el("div");
    left.style.fontWeight = "700";
    left.textContent = p.label;

    const rm = miniButton("Remove", () => {
      pointSets.splice(i, 1);
      rebuildPointsUI();
      rerender();
    });
    rm.disabled = pointSets.length <= 1;

    header.append(left, rm);
    box.append(header);

    box.append(
      makeCheckbox("Enabled", () => p.enabled, (v) => (p.enabled = v)),
      makeTextarea("Points (one per line: (x,y) or x,y)", () => p.pointsText, (v) => (p.pointsText = v), 5),
      makeColorInput("Point color", () => p.pointColor, (v) => (p.pointColor = v)),
      makeNumberInput("Point radius (px)", () => p.pointRadius, (v) => (p.pointRadius = v), 1),
      makeCheckbox("Connect points in order", () => p.connectInOrder, (v) => (p.connectInOrder = v)),
      makeColorInput("Connection line color", () => p.lineColor, (v) => (p.lineColor = v)),
      makeNumberInput("Connection line width", () => p.lineWidth, (v) => (p.lineWidth = v), 0.5)
    );

    secPoints.body.append(box);
  });
}

function rebuildSegsUI() {
  secSegs.body.innerHTML = "";

  secSegs.body.append(
    miniButton(`+ Add segment set (${segmentSets.length}/${MAX_SEGSETS})`, () => {
      if (segmentSets.length >= MAX_SEGSETS) return;
      const idx = segmentSets.length + 1;
      segmentSets.push({
        enabled: true,
        label: `Segments ${String.fromCharCode(64 + idx)}`,
        segmentsText: `(-5,0)->(5,0)\n(0,-5)->(0,5)`,
        color: "#000000",
        width: 2,
      });
      rebuildSegsUI();
      rerender();
    })
  );

  segmentSets.forEach((s, i) => {
    const box = rowWrap();

    const header = el("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";

    const left = el("div");
    left.style.fontWeight = "700";
    left.textContent = s.label;

    const rm = miniButton("Remove", () => {
      segmentSets.splice(i, 1);
      rebuildSegsUI();
      rerender();
    });
    rm.disabled = segmentSets.length <= 1;

    header.append(left, rm);
    box.append(header);

    box.append(
      makeCheckbox("Enabled", () => s.enabled, (v) => (s.enabled = v)),
      makeTextarea("Segments (one per line: (x1,y1)->(x2,y2))", () => s.segmentsText, (v) => (s.segmentsText = v), 5),
      makeColorInput("Segment color", () => s.color, (v) => (s.color = v)),
      makeNumberInput("Segment width", () => s.width, (v) => (s.width = v), 0.5)
    );

    secSegs.body.append(box);
  });
}

function rebuildAnnoUI() {
  secAnno.body.innerHTML = "";

  const addBtn = miniButton(`+ Add annotation (${annotations.length}/${MAX_ANNOS})`, () => {
  if (annotations.length >= MAX_ANNOS) return;

  const id = `a_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const cx = (grid.xmin + grid.xmax) / 2;
  const cy = (grid.ymin + grid.ymax) / 2;

  annotations.push({
    id,
    text: "Label",
    x: cx,
    y: cy,
    color: "#000000",
    fontSize: 18,
    bold: true,
    clipToPlot: true,
  });

  rebuildAnnoUI();
  rerender();
});

addBtn.disabled = annotations.length >= MAX_ANNOS;
secAnno.body.append(addBtn);


  annotations.forEach((a, i) => {
    const box = rowWrap();

    const header = el("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";

    const left = el("div");
    left.style.fontWeight = "700";
    left.textContent = `Annotation ${i + 1}`;

    const rm = miniButton("Remove", () => {
      annotations.splice(i, 1);
      rebuildAnnoUI();
      rerender();
    });

    header.append(left, rm);
    box.append(header);

    box.append(
      makeTextInput("Text", () => a.text, (v) => (a.text = v)),
      makeColorInput("Color", () => a.color, (v) => (a.color = v)),
      makeNumberInput("Font size", () => a.fontSize, (v) => (a.fontSize = v), 1),
      makeCheckbox("Bold", () => a.bold, (v) => (a.bold = v)),
      makeCheckbox("Clip to plot", () => a.clipToPlot, (v) => (a.clipToPlot = v)),
      makeNumberInput("x (graph)", () => a.x, (v) => (a.x = v), 0.5),
      makeNumberInput("y (graph)", () => a.y, (v) => (a.y = v), 0.5)
    );

    secAnno.body.append(box);
  });
}

rebuildFunctionUI();
rebuildPointsUI();
rebuildSegsUI();
rebuildAnnoUI();

// =====================
// Drag handlers
// =====================
function attachAnnotationDragHandlers() {
  const svg = previewEl.querySelector("svg");
  if (!svg) return;

  const { invX, invY } = makeMapper(grid);

  svg.querySelectorAll<SVGTextElement>("[data-anno-id]").forEach((node) => {
    node.style.pointerEvents = "all";

    node.onpointerdown = (e: PointerEvent) => {
      const id = (node.getAttribute("data-anno-id") || "").trim();
      const a = annotations.find((x) => x.id === id);
      if (!a) return;

      node.setPointerCapture(e.pointerId);

      const startX = Number(node.getAttribute("x") || "0");
      const startY = Number(node.getAttribute("y") || "0");
      const startClientX = e.clientX;
      const startClientY = e.clientY;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startClientX;
        const dy = ev.clientY - startClientY;

        const px = startX + dx;
        const py = startY + dy;

        node.setAttribute("x", String(px));
        node.setAttribute("y", String(py));
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);

        const px = Number(node.getAttribute("x") || "0");
        const py = Number(node.getAttribute("y") || "0");

        a.x = invX(px);
        a.y = invY(py);

        rebuildAnnoUI();
        rerender();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  });
}

// =====================
// Render + Download
// =====================
let lastSVG = "";

function rerender() {
  errEl.textContent = "";
  try {
    grid.size = clamp(grid.size, 200, 2400);
    grid.minorStep = clamp(grid.minorStep, 0.1, 1000);
    grid.majorStep = clamp(grid.majorStep, 0.1, 1000);
    grid.labelStep = clamp(grid.labelStep, 0.1, 1000);

    functions.forEach((f) => {
      f.width = clamp(f.width, 0.5, 20);
      f.samplesPerPixel = clamp(f.samplesPerPixel, 0.2, 6);
      f.domainMin = clamp(f.domainMin, -1e6, 1e6);
      f.domainMax = clamp(f.domainMax, -1e6, 1e6);
      f.endpointRadius = clamp(f.endpointRadius, 2, 20);
    });

    pointSets.forEach((p) => {
      p.pointRadius = clamp(p.pointRadius, 1, 30);
      p.lineWidth = clamp(p.lineWidth, 0.5, 20);
    });

    segmentSets.forEach((s) => {
      s.width = clamp(s.width, 0.5, 20);
    });

    const anno = overlayAnnotations(grid, annotations);

    const overlaysClipped = [
      ...overlaySegmentSets(grid, segmentSets),
      ...overlayFunctions(grid, functions, style.background),
      ...overlayPointSets(grid, pointSets),
    ];

    lastSVG = renderCartesian(grid, style, overlaysClipped, anno.clipped, anno.free);

    previewEl.innerHTML = lastSVG;
    attachAnnotationDragHandlers();
  } catch (e: any) {
    errEl.textContent = e?.message ?? String(e);
  }
}

function downloadSVG() {
  if (!lastSVG) return;
  const blob = new Blob([lastSVG], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "graph.svg";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadPNG() {
  if (!lastSVG) return;

  const svgBlob = new Blob([lastSVG], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("SVG→PNG conversion blocked. Download SVG instead."));
    img.src = url;
  });

  const exportW = 1600;
  const scale = exportW / img.width;

  const canvas = document.createElement("canvas");
  canvas.width = exportW;
  canvas.height = Math.round(img.height * scale);

  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  URL.revokeObjectURL(url);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "graph.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }, "image/png");
}

(document.getElementById("dlSvg") as HTMLButtonElement).onclick = downloadSVG;
(document.getElementById("dlPng") as HTMLButtonElement).onclick = downloadPNG;

rerender();
