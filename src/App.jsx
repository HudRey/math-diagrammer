import { useState, useRef, useEffect } from "react";

// ---------- constants ----------
const W = 800, H = 600;
const STROKES = ["#1F2937", "#2563EB", "#DC2626", "#059669", "#D97706", "#7C3AED", "#0891B2", "#DB2777"];
const FILLS = ["none", "#DBEAFE", "#FEE2E2", "#D1FAE5", "#FEF3C7", "#EDE9FE", "#CFFAFE", "#FCE7F3"];

const SYSTEM_PROMPT = `You generate 2D math diagrams as JSON for an 800x600 canvas. Respond with ONLY valid JSON — no markdown fences, no explanation.

Schema:
{
  "shapes": [
    {"id":"s1","type":"polygon","points":[{"x":120,"y":460},{"x":360,"y":460},{"x":240,"y":220}],"vertexLabels":["A","B","C"],"sideLabels":["","",""],"stroke":"#2563EB","fill":"none","strokeWidth":2.5},
    {"id":"s2","type":"segment","points":[{"x":100,"y":100},{"x":300,"y":200}],"vertexLabels":["P","Q"],"stroke":"#1F2937","fill":"none","strokeWidth":2.5},
    {"id":"s3","type":"circle","cx":400,"cy":300,"r":90,"label":"O","stroke":"#1F2937","fill":"none","strokeWidth":2.5}
  ],
  "annotations": [
    {"id":"a1","x":400,"y":60,"text":"△ABC ~ △DEF","color":"#1F2937","fontSize":20}
  ]
}

Hard rules:
- Mathematical correctness is the top priority. Similar figures must use an exact scale factor with equal corresponding angles. Right angles must be exactly 90°. Congruent figures must be congruent. Compute coordinates precisely (decimals allowed). Remember screen y increases DOWNWARD.
- Keep everything inside x:60–740, y:60–540. Space multiple figures apart so labels don't collide.
- Corresponding vertices of similar/congruent figures should be in corresponding positions/orientations unless the user asks otherwise.
- vertexLabels order matches points order. sideLabels[i] labels the side from points[i] to points[i+1] (wrapping); use "" for unlabeled sides. Use sideLabels for given side lengths (e.g. "6", "9", "x").
- Default stroke "#1F2937", fill "none", strokeWidth 2.5. If multiple figures, give each a different stroke from: #2563EB, #DC2626, #059669, #D97706, #7C3AED — unless the user specifies colors.
- Use annotations sparingly for titles, similarity statements, or measurements that aren't side labels.
- If the user message includes a "Current diagram" JSON and the request is a modification, return the FULL updated JSON. If it's clearly a new diagram request, return a fresh diagram.`;

const EXAMPLES = [
  "Two similar triangles ABC and DEF, scale factor 2, with side lengths labeled",
  "A right triangle with legs 6 and 8, hypotenuse labeled x",
  "A circle with center O, radius r, and an inscribed triangle",
  "Parallel lines cut by a transversal, angles labeled 1–8",
];

// ---------- geometry helpers ----------
const centroid = (pts) => {
  const n = pts.length;
  return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
};
const away = (p, from, dist) => {
  const dx = p.x - from.x, dy = p.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: p.x + (dx / len) * dist, y: p.y + (dy / len) * dist };
};
const uid = () => "id" + Math.random().toString(36).slice(2, 9);

// ---------- normalization ----------
function normalizeScene(raw) {
  const scene = { shapes: [], annotations: [] };
  (raw.shapes || []).forEach((s) => {
    const base = {
      id: s.id || uid(),
      type: s.type,
      stroke: s.stroke || "#1F2937",
      fill: s.fill || "none",
      strokeWidth: Number(s.strokeWidth) || 2.5,
    };
    if (s.type === "circle") {
      scene.shapes.push({ ...base, cx: +s.cx || W / 2, cy: +s.cy || H / 2, r: +s.r || 60, label: s.label || "" });
    } else if ((s.type === "polygon" || s.type === "segment") && Array.isArray(s.points) && s.points.length >= 2) {
      scene.shapes.push({
        ...base,
        points: s.points.map((p) => ({ x: +p.x, y: +p.y })),
        vertexLabels: Array.isArray(s.vertexLabels) ? s.vertexLabels : [],
        sideLabels: Array.isArray(s.sideLabels) ? s.sideLabels : [],
      });
    }
  });
  (raw.annotations || []).forEach((a) => {
    scene.annotations.push({
      id: a.id || uid(),
      x: +a.x || W / 2,
      y: +a.y || 60,
      text: String(a.text ?? ""),
      color: a.color || "#1F2937",
      fontSize: Number(a.fontSize) || 18,
    });
  });
  return scene;
}

// ---------- component ----------
export default function MathDiagrammer() {
  const [scene, setScene] = useState({ shapes: [], annotations: [] });
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [showGrid, setShowGrid] = useState(true);

  const svgRef = useRef(null);
  const sceneRef = useRef(scene);
  const historyRef = useRef([]);
  const dragRef = useRef(null);
  sceneRef.current = scene;

  const pushHistory = (snap) => {
    historyRef.current.push(JSON.parse(JSON.stringify(snap)));
    if (historyRef.current.length > 60) historyRef.current.shift();
  };
  const undo = () => {
    const prev = historyRef.current.pop();
    if (prev) { setScene(prev); setSelectedId(null); }
  };

  // ----- coordinate conversion -----
  const toSvg = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) * W) / rect.width, y: ((e.clientY - rect.top) * H) / rect.height };
  };

  // ----- dragging -----
  const startDrag = (e, info) => {
    e.stopPropagation();
    setSelectedId(info.id);
    dragRef.current = {
      ...info,
      start: toSvg(e),
      orig: JSON.parse(JSON.stringify(sceneRef.current)),
      moved: false,
    };
  };

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const now = toSvg(e);
      const dx = now.x - d.start.x, dy = now.y - d.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) d.moved = true;
      const next = JSON.parse(JSON.stringify(d.orig));
      if (d.kind === "shape") {
        const s = next.shapes.find((s) => s.id === d.id);
        if (s.type === "circle") { s.cx += dx; s.cy += dy; }
        else s.points = s.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      } else if (d.kind === "vertex") {
        const s = next.shapes.find((s) => s.id === d.id);
        s.points[d.vi] = { x: s.points[d.vi].x + dx, y: s.points[d.vi].y + dy };
      } else if (d.kind === "radius") {
        const s = next.shapes.find((s) => s.id === d.id);
        s.r = Math.max(10, Math.hypot(now.x - s.cx, now.y - s.cy));
      } else if (d.kind === "annotation") {
        const a = next.annotations.find((a) => a.id === d.id);
        a.x += dx; a.y += dy;
      }
      setScene(next);
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d && d.moved) pushHistory(d.orig);
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, []);

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e) => {
      const typing = ["INPUT", "TEXTAREA"].includes(e.target.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !typing) { e.preventDefault(); undo(); }
      if ((e.key === "Delete" || e.key === "Backspace") && !typing && selectedId) { e.preventDefault(); deleteSelected(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ----- mutations -----
  const mutate = (fn) => {
    pushHistory(sceneRef.current);
    const next = JSON.parse(JSON.stringify(sceneRef.current));
    fn(next);
    setScene(next);
  };
  const selectedShape = scene.shapes.find((s) => s.id === selectedId);
  const selectedAnno = scene.annotations.find((a) => a.id === selectedId);

  const deleteSelected = () => {
    mutate((s) => {
      s.shapes = s.shapes.filter((x) => x.id !== selectedId);
      s.annotations = s.annotations.filter((x) => x.id !== selectedId);
    });
    setSelectedId(null);
  };
  const addAnnotation = () => {
    const id = uid();
    mutate((s) => s.annotations.push({ id, x: W / 2, y: H / 2, text: "Label", color: "#1F2937", fontSize: 18 }));
    setSelectedId(id);
  };

  // ----- generate -----
  async function generate() {
    if (!prompt.trim() || loading) return;
    setLoading(true); setError(null);
    try {
      let userMsg = prompt.trim();
      if (sceneRef.current.shapes.length || sceneRef.current.annotations.length) {
        userMsg = `Current diagram: ${JSON.stringify(sceneRef.current)}\n\nRequest: ${prompt.trim()}`;
      }
     const response = await fetch("/api/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMsg }],
  }),
});

      const data = await response.json();
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      const jsonStr = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      const parsed = JSON.parse(jsonStr);
      pushHistory(sceneRef.current);
      setScene(normalizeScene(parsed));
      setSelectedId(null);
    } catch (err) {
      console.error(err);
      setError("Couldn't generate that one — try rewording or simplifying the prompt.");
    }
    setLoading(false);
  }

  // ----- export -----
  const buildSvgString = () => {
    const clone = svgRef.current.cloneNode(true);
    clone.querySelectorAll("[data-ui]").forEach((n) => n.remove());
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", W);
    clone.setAttribute("height", H);
    return new XMLSerializer().serializeToString(clone);
  };
  const download = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };
  const exportSVG = () => download(new Blob([buildSvgString()], { type: "image/svg+xml" }), "diagram.svg");
  const exportPNG = () => {
    const svgStr = buildSvgString();
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = W * 2; c.height = H * 2;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => download(b, "diagram.png"));
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgStr)));
  };

  // ----- render helpers -----
  const renderShape = (s) => {
    const sel = s.id === selectedId;
    const els = [];
    if (s.type === "circle") {
      if (sel) els.push(<circle key="glow" data-ui="1" cx={s.cx} cy={s.cy} r={s.r} fill="none" stroke="#2563EB" strokeOpacity="0.3" strokeWidth={s.strokeWidth + 6} />);
      els.push(<circle key="c" cx={s.cx} cy={s.cy} r={s.r} fill={s.fill === "none" ? "transparent" : s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} style={{ cursor: "move" }} onPointerDown={(e) => startDrag(e, { kind: "shape", id: s.id })} />);
      els.push(<circle key="ctr" cx={s.cx} cy={s.cy} r={2.5} fill={s.stroke} pointerEvents="none" />);
      if (s.label) els.push(<text key="lbl" x={s.cx + 8} y={s.cy - 8} fontSize="18" fontFamily="Georgia, serif" fontStyle="italic" fill={s.stroke} pointerEvents="none">{s.label}</text>);
      if (sel) els.push(<circle key="rh" data-ui="1" cx={s.cx + s.r} cy={s.cy} r={6} fill="#fff" stroke="#2563EB" strokeWidth="2" style={{ cursor: "ew-resize" }} onPointerDown={(e) => startDrag(e, { kind: "radius", id: s.id })} />);
      return <g key={s.id}>{els}</g>;
    }
    const pts = s.points;
    const c = pts.length > 2 ? centroid(pts) : { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const ptStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
    if (s.type === "polygon") {
      if (sel) els.push(<polygon key="glow" data-ui="1" points={ptStr} fill="none" stroke="#2563EB" strokeOpacity="0.3" strokeWidth={s.strokeWidth + 6} />);
      els.push(<polygon key="p" points={ptStr} fill={s.fill === "none" ? "transparent" : s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} strokeLinejoin="round" style={{ cursor: "move" }} onPointerDown={(e) => startDrag(e, { kind: "shape", id: s.id })} />);
    } else {
      if (sel) els.push(<line key="glow" data-ui="1" x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} stroke="#2563EB" strokeOpacity="0.3" strokeWidth={s.strokeWidth + 6} />);
      els.push(<line key="l" x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} stroke={s.stroke} strokeWidth={s.strokeWidth} strokeLinecap="round" style={{ cursor: "move" }} onPointerDown={(e) => startDrag(e, { kind: "shape", id: s.id })} />);
      els.push(<line key="hit" x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} stroke="transparent" strokeWidth="14" data-ui="1" style={{ cursor: "move" }} onPointerDown={(e) => startDrag(e, { kind: "shape", id: s.id })} />);
    }
    // vertex labels
    (s.vertexLabels || []).forEach((lbl, i) => {
      if (!lbl || !pts[i]) return;
      const from = s.type === "segment" ? pts[1 - i] : c;
      const pos = away(pts[i], from, 20);
      els.push(<text key={"v" + i} x={pos.x} y={pos.y} fontSize="19" fontFamily="Georgia, serif" fontStyle="italic" fill={s.stroke} textAnchor="middle" dominantBaseline="middle" pointerEvents="none">{lbl}</text>);
    });
    // side labels
    if (s.type === "polygon") (s.sideLabels || []).forEach((lbl, i) => {
      if (!lbl || !pts[i]) return;
      const j = (i + 1) % pts.length;
      const mid = { x: (pts[i].x + pts[j].x) / 2, y: (pts[i].y + pts[j].y) / 2 };
      const pos = away(mid, c, 18);
      els.push(<text key={"s" + i} x={pos.x} y={pos.y} fontSize="16" fontFamily="Georgia, serif" fill="#374151" textAnchor="middle" dominantBaseline="middle" pointerEvents="none">{lbl}</text>);
    });
    // vertex handles
    if (sel) pts.forEach((p, i) => els.push(
      <circle key={"h" + i} data-ui="1" cx={p.x} cy={p.y} r={6} fill="#fff" stroke="#2563EB" strokeWidth="2" style={{ cursor: "grab" }} onPointerDown={(e) => startDrag(e, { kind: "vertex", id: s.id, vi: i })} />
    ));
    return <g key={s.id}>{els}</g>;
  };

  const Swatches = ({ colors, value, onPick, allowNone }) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {colors.map((col) => (
        <button key={col} onClick={() => onPick(col)} title={col}
          style={{
            width: 26, height: 26, borderRadius: 6, cursor: "pointer",
            background: col === "none" ? "repeating-linear-gradient(45deg,#fff,#fff 4px,#E5E7EB 4px,#E5E7EB 8px)" : col,
            border: value === col ? "2px solid #2563EB" : "1px solid #D1D5DB",
            outline: "none",
          }} />
      ))}
    </div>
  );

  const btn = {
    padding: "8px 12px", borderRadius: 8, border: "1px solid #D1D5DB", background: "#fff",
    fontSize: 13, fontWeight: 600, color: "#1F2937", cursor: "pointer", fontFamily: "inherit",
  };
  const label = { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B7280", marginBottom: 6 };
  const empty = !scene.shapes.length && !scene.annotations.length;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#F3F4F6", fontFamily: "'Avenir Next','Segoe UI',system-ui,sans-serif", color: "#111827" }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "#111827", flexWrap: "wrap" }}>
        <div style={{ color: "#fff", fontWeight: 800, fontSize: 17, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
          <span style={{ color: "#60A5FA" }}>△</span> Math Diagrammer
        </div>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generate()}
          placeholder={empty ? "Describe a diagram — e.g. two similar triangles ABC and DEF with a scale factor of 2" : "Describe a new diagram, or a change — e.g. make DEF twice as big"}
          style={{ flex: 1, minWidth: 220, padding: "10px 14px", borderRadius: 10, border: "1px solid #374151", background: "#1F2937", color: "#F9FAFB", fontSize: 14, outline: "none", fontFamily: "inherit" }}
        />
        <button onClick={generate} disabled={loading || !prompt.trim()}
          style={{ ...btn, background: loading ? "#93C5FD" : "#2563EB", border: "none", color: "#fff", padding: "10px 18px", opacity: !prompt.trim() && !loading ? 0.5 : 1 }}>
          {loading ? "Drawing…" : "Generate"}
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* canvas */}
        <div style={{ flex: 1, padding: 16, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.1)", border: "1px solid #E5E7EB" }}>
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", aspectRatio: "4/3", touchAction: "none", background: "#fff" }}>
              <defs>
                <pattern id="grid" width="25" height="25" patternUnits="userSpaceOnUse">
                  <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#E3EDF4" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width={W} height={H} fill="#fff" onPointerDown={() => setSelectedId(null)} />
              {showGrid && <rect width={W} height={H} fill="url(#grid)" pointerEvents="none" />}
              {scene.shapes.map(renderShape)}
              {scene.annotations.map((a) => (
                <g key={a.id}>
                  {a.id === selectedId && (
                    <rect data-ui="1" x={a.x - a.text.length * a.fontSize * 0.3 - 6} y={a.y - a.fontSize * 0.75 - 4}
                      width={a.text.length * a.fontSize * 0.6 + 12} height={a.fontSize * 1.4 + 4}
                      fill="none" stroke="#2563EB" strokeDasharray="4 3" rx="4" />
                  )}
                  <text x={a.x} y={a.y} fontSize={a.fontSize} fill={a.color} fontFamily="Georgia, serif"
                    textAnchor="middle" dominantBaseline="middle" style={{ cursor: "move", userSelect: "none" }}
                    onPointerDown={(e) => startDrag(e, { kind: "annotation", id: a.id })}>{a.text}</text>
                </g>
              ))}
            </svg>
            {empty && !loading && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, pointerEvents: "none" }}>
                <div style={{ color: "#9CA3AF", fontSize: 15 }}>Describe a diagram above, or try one of these:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 560, pointerEvents: "auto" }}>
                  {EXAMPLES.map((ex) => (
                    <button key={ex} onClick={() => setPrompt(ex)} style={{ ...btn, fontWeight: 500, fontSize: 12.5, color: "#374151" }}>{ex}</button>
                  ))}
                </div>
              </div>
            )}
            {loading && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 600, color: "#2563EB" }}>
                Computing coordinates…
              </div>
            )}
          </div>
          {error && <div style={{ marginTop: 10, padding: "10px 14px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, color: "#B91C1C", fontSize: 13 }}>{error}</div>}
          <div style={{ marginTop: 8, fontSize: 12, color: "#6B7280" }}>
            Click a shape to select · drag to move · drag handles to reshape · Delete key removes · Ctrl+Z undoes
          </div>
        </div>

        {/* sidebar */}
        <div style={{ width: 250, padding: "16px 16px 16px 0", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
          {selectedShape && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Selected {selectedShape.type}</div>
              <div><div style={label}>Line color</div>
                <Swatches colors={STROKES} value={selectedShape.stroke} onPick={(col) => mutate((s) => { s.shapes.find((x) => x.id === selectedId).stroke = col; })} />
              </div>
              {selectedShape.type !== "segment" && (
                <div><div style={label}>Fill</div>
                  <Swatches colors={FILLS} value={selectedShape.fill} onPick={(col) => mutate((s) => { s.shapes.find((x) => x.id === selectedId).fill = col; })} />
                </div>
              )}
              <div><div style={label}>Line width — {selectedShape.strokeWidth}</div>
                <input type="range" min="1" max="6" step="0.5" value={selectedShape.strokeWidth} style={{ width: "100%" }}
                  onChange={(e) => mutate((s) => { s.shapes.find((x) => x.id === selectedId).strokeWidth = +e.target.value; })} />
              </div>
              {selectedShape.points && (
                <div><div style={label}>Vertex labels</div>
                  <input value={(selectedShape.vertexLabels || []).join(",")}
                    onChange={(e) => mutate((s) => { s.shapes.find((x) => x.id === selectedId).vertexLabels = e.target.value.split(","); })}
                    placeholder="A,B,C"
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #D1D5DB", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              )}
              <button onClick={deleteSelected} style={{ ...btn, color: "#DC2626", borderColor: "#FECACA" }}>Delete shape</button>
            </div>
          )}

          {selectedAnno && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Selected text</div>
              <input value={selectedAnno.text} autoFocus
                onChange={(e) => mutate((s) => { s.annotations.find((x) => x.id === selectedId).text = e.target.value; })}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #D1D5DB", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              <div><div style={label}>Color</div>
                <Swatches colors={STROKES} value={selectedAnno.color} onPick={(col) => mutate((s) => { s.annotations.find((x) => x.id === selectedId).color = col; })} />
              </div>
              <div><div style={label}>Size — {selectedAnno.fontSize}px</div>
                <input type="range" min="12" max="36" value={selectedAnno.fontSize} style={{ width: "100%" }}
                  onChange={(e) => mutate((s) => { s.annotations.find((x) => x.id === selectedId).fontSize = +e.target.value; })} />
              </div>
              <button onClick={deleteSelected} style={{ ...btn, color: "#DC2626", borderColor: "#FECACA" }}>Delete text</button>
            </div>
          )}

          {!selectedShape && !selectedAnno && !empty && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 14, fontSize: 13, color: "#6B7280" }}>
              Click any shape or label on the canvas to edit its colors and text.
            </div>
          )}

          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={label}>Tools</div>
            <button onClick={addAnnotation} style={btn}>+ Add text label</button>
            <button onClick={undo} style={btn}>Undo</button>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "4px 2px" }}>
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Show grid
            </label>
            <button onClick={() => { pushHistory(sceneRef.current); setScene({ shapes: [], annotations: [] }); setSelectedId(null); }} style={btn}>Clear canvas</button>
          </div>

          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={label}>Export</div>
            <button onClick={exportPNG} style={{ ...btn, background: "#111827", color: "#fff", border: "none" }} disabled={empty}>Download PNG</button>
            <button onClick={exportSVG} style={btn} disabled={empty}>Download SVG</button>
          </div>
        </div>
      </div>
    </div>
  );
}