"use client";

import React, { useState, useRef, useEffect } from "react";

// ==========================================
// 1. CONSTANTS
// ==========================================
const W = 800;
const H = 600;
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
  "marks": [
    {"id":"m1","type":"angle","vertex":{"x":120,"y":460},"arm1":{"x":360,"y":460},"arm2":{"x":240,"y":220},"arcs":1,"right":false,"label":"","color":"#1F2937"},
    {"id":"m2","type":"ticks","from":{"x":120,"y":460},"to":{"x":360,"y":460},"count":1,"color":"#1F2937"},
    {"id":"m3","type":"parallel","from":{"x":100,"y":150},"to":{"x":700,"y":150},"count":1,"color":"#1F2937"}
  ],
  "annotations": [
    {"id":"a1","x":400,"y":60,"text":"△ABC ~ △DEF","color":"#1F2937","fontSize":20}
  ]
}`;

const EXAMPLES = [
  "Two similar triangles ABC and DEF, scale factor 2, with equal angles marked",
  "A right triangle with legs 6 and 8, hypotenuse labeled x",
  "An isosceles triangle with congruent sides tick-marked and base angles marked",
  "Parallel lines cut by a transversal, angles labeled 1–8",
];

const EMPTY_SCENE = { shapes: [], marks: [], annotations: [] };

const btnStyle = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #D1D5DB",
  background: "#fff",
  fontSize: 13,
  fontWeight: 600,
  color: "#1F2937",
  cursor: "pointer",
  fontFamily: "inherit",
};

const labelStyle = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#6B7280",
  marginBottom: 6,
};

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================
function centroid(pts) {
  const n = pts.length;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
  };
}

function away(p, from, dist) {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: p.x + (dx / len) * dist, y: p.y + (dy / len) * dist };
}

function uid() {
  return "id" + Math.random().toString(36).slice(2, 9);
}

function lineIntersections(shapes) {
  const segs = [];
  shapes.forEach((s) => {
    if (s.type === "segment") segs.push([s.points[0], s.points[1]]);
    if (s.type === "polygon") {
      for (let i = 0; i < s.points.length; i++) {
        segs.push([s.points[i], s.points[(i + 1) % s.points.length]]);
      }
    }
  });
  const pts = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const [p1, p2] = segs[i], [p3, p4] = segs[j];
      const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
      if (Math.abs(d) < 1e-9) continue;
      const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
      const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
      if (t < -0.05 || t > 1.05 || u < -0.05 || u > 1.05) continue;
      pts.push({ x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) });
    }
  }
  return pts;
}

function normalizeScene(raw) {
  if (!raw || typeof raw !== "object") return { shapes: [], marks: [], annotations: [] };
  const scene = { shapes: [], marks: [], annotations: [] };

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

  (raw.marks || []).forEach((m) => {
    if (m.type === "angle" && m.vertex && m.arm1 && m.arm2) {
      scene.marks.push({
        id: m.id || uid(),
        type: "angle",
        vertex: { x: +m.vertex.x, y: +m.vertex.y },
        arm1: { x: +m.arm1.x, y: +m.arm1.y },
        arm2: { x: +m.arm2.x, y: +m.arm2.y },
        arcs: Math.min(3, Math.max(1, Math.round(+m.arcs) || 1)),
        right: !!m.right,
        label: m.label ? String(m.label) : "",
        color: m.color || "#1F2937",
      });
    } else if ((m.type === "ticks" || m.type === "parallel") && m.from && m.to) {
      scene.marks.push({
        id: m.id || uid(),
        type: m.type,
        from: { x: +m.from.x, y: +m.from.y },
        to: { x: +m.to.x, y: +m.to.y },
        count: Math.min(3, Math.max(1, Math.round(+m.count) || 1)),
        color: m.color || "#1F2937",
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

  const inters = lineIntersections(scene.shapes);
  scene.marks.forEach((m) => {
    if (m.type !== "angle") return;
    let best = null, bestD = 40;
    inters.forEach((p) => {
      const dist = Math.hypot(p.x - m.vertex.x, p.y - m.vertex.y);
      if (dist < bestD) {
        bestD = dist;
        best = p;
      }
    });
    if (best) {
      const ddx = best.x - m.vertex.x, ddy = best.y - m.vertex.y;
      m.vertex.x += ddx; m.vertex.y += ddy;
      m.arm1.x += ddx; m.arm1.y += ddy;
      m.arm2.x += ddx; m.arm2.y += ddy;
    }
  });

  return scene;
}

function Swatches({ colors, value, onPick }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {colors.map((col) => (
        <button
          key={col}
          onClick={() => onPick(col)}
          title={col}
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            cursor: "pointer",
            background:
              col === "none"
                ? "repeating-linear-gradient(45deg,#fff,#fff 4px,#E5E7EB 4px,#E5E7EB 8px)"
                : col,
            border: value === col ? "2px solid #2563EB" : "1px solid #D1D5DB",
            outline: "none",
          }}
        />
      ))}
    </div>
  );
}

// ==========================================
// 3. MAIN COMPONENT
// ==========================================
export default function App() {
  const [scene, setScene] = useState(EMPTY_SCENE);
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
    if (prev) {
      setScene(prev);
      setSelectedId(null);
    }
  };

  const toSvg = (e) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * W) / rect.width,
      y: ((e.clientY - rect.top) * H) / rect.height,
    };
  };

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
        const s = next.shapes.find((x) => x.id === d.id);
        if (s) {
          if (s.type === "circle") {
            s.cx += dx;
            s.cy += dy;
          } else {
            s.points = s.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          }
        }
      } else if (d.kind === "vertex") {
        const s = next.shapes.find((x) => x.id === d.id);
        if (s && s.points[d.vi]) {
          s.points[d.vi] = { x: s.points[d.vi].x + dx, y: s.points[d.vi].y + dy };
        }
      } else if (d.kind === "radius") {
        const s = next.shapes.find((x) => x.id === d.id);
        if (s) s.r = Math.max(10, Math.hypot(now.x - s.cx, now.y - s.cy));
      } else if (d.kind === "mark") {
        const m = (next.marks || []).find((x) => x.id === d.id);
        if (m) {
          if (m.type === "angle") {
            m.vertex.x += dx; m.vertex.y += dy;
            m.arm1.x += dx; m.arm1.y += dy;
            m.arm2.x += dx; m.arm2.y += dy;
          } else {
            m.from.x += dx; m.from.y += dy;
            m.to.x += dx; m.to.y += dy;
          }
        }
      } else if (d.kind === "annotation") {
        const a = next.annotations.find((x) => x.id === d.id);
        if (a) {
          a.x += dx;
          a.y += dy;
        }
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
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const typing = ["INPUT", "TEXTAREA"].includes(e.target.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !typing) {
        e.preventDefault();
        undo();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !typing && selectedId) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const mutate = (fn) => {
    pushHistory(sceneRef.current);
    const next = JSON.parse(JSON.stringify(sceneRef.current));
    if (!next.marks) next.marks = [];
    fn(next);
    setScene(next);
  };

  const selectedShape = scene.shapes.find((s) => s.id === selectedId);
  const selectedMark = (scene.marks || []).find((m) => m.id === selectedId);
  const selectedAnno = scene.annotations.find((a) => a.id === selectedId);

  const deleteSelected = () => {
    mutate((s) => {
      s.shapes = s.shapes.filter((x) => x.id !== selectedId);
      s.marks = (s.marks || []).filter((x) => x.id !== selectedId);
      s.annotations = s.annotations.filter((x) => x.id !== selectedId);
    });
    setSelectedId(null);
  };

  const addAnnotation = () => {
    const id = uid();
    mutate((s) =>
      s.annotations.push({
        id,
        x: W / 2,
        y: H / 2,
        text: "Label",
        color: "#1F2937",
        fontSize: 18,
      })
    );
    setSelectedId(id);
  };

 // Safe Teacher-Friendly Generation
  async function generate() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);

    let password = localStorage.getItem("md_password");
    if (!password) {
      password = window.prompt("Enter the teacher access password:");
      if (!password) {
        setLoading(false);
        return;
      }
      localStorage.setItem("md_password", password.trim());
    }

    try {
      let userMsg = prompt.trim();
      const cur = sceneRef.current;
      if (cur.shapes.length || (cur.marks || []).length || cur.annotations.length) {
        userMsg = `Current diagram: ${JSON.stringify(cur)}\n\nRequest: ${prompt.trim()}`;
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-app-password": password
        },
        body: JSON.stringify({
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMsg }]
        })
      });

      // Safely read response text first to prevent JSON syntax crash
      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseErr) {
        throw new Error(responseText || "Server error occurred");
      }

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem("md_password");
          throw new Error("Incorrect password. Please refresh and try again.");
        }
        throw new Error(data.error || "Failed to generate diagram.");
      }

      const rawText = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      const jsonStr = rawText.slice(rawText.indexOf("{"), rawText.lastIndexOf("}") + 1);
      const parsed = JSON.parse(jsonStr);

      pushHistory(sceneRef.current);
      setScene(normalizeScene(parsed));
      setSelectedId(null);
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to generate diagram.");
    }
    setLoading(false);
  }

  const buildSvgString = () => {
    if (!svgRef.current) return "";
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
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSVG = () =>
    download(new Blob([buildSvgString()], { type: "image/svg+xml" }), "diagram.svg");

  const exportPNG = () => {
    const svgStr = buildSvgString();
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = W * 2;
      c.height = H * 2;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => download(b, "diagram.png"));
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgStr)));
  };

  const copyToClipboard = async () => {
    try {
      const svgStr = buildSvgString();
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = W * 2;
        c.height = H * 2;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(async (blob) => {
          if (blob) {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            alert("Copied high-res diagram to clipboard! Ready to paste into Docs/Word.");
          }
        });
      };
      img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgStr)));
    } catch (err) {
      alert("Clipboard copy not supported in this browser. Use 'Download PNG'.");
    }
  };

  const renderShape = (s) => {
    const sel = s.id === selectedId;
    const els = [];
    if (s.type === "circle") {
      if (sel)
        els.push(
          <circle
            key="glow"
            data-ui="1"
            cx={s.cx}
            cy={s.cy}
            r={s.r}
            fill="none"
            stroke="#2563EB"
            strokeOpacity="0.3"
            strokeWidth={s.strokeWidth + 6}
          />
        );
      els.push(
        <circle
          key="c"
          cx={s.cx}
          cy={s.cy}
          r={s.r}
          fill={s.fill === "none" ? "transparent" : s.fill}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
          style={{ cursor: "move" }}
          onPointerDown={(e) => startDrag(e, { kind: "shape", id: s.id })}
        />
      );
      els.push(<circle key="ctr" cx={s.cx} cy={s.cy} r={2.5} fill={s.stroke} pointerEvents="none" />);
      if (s.label)
        els.push(
          <text
            key="lbl"
            x={s.cx + 8}
            y={s.cy - 8}
            fontSize="18"
            fontFamily="Georgia, serif"
            fontStyle="italic"
            fill={s.stroke}
            pointerEvents="none"
          >
            {s.label}
          </text>
        );
      if (sel)
        els.push(
          <circle
            key="rh"
            data-ui="1"
            cx={s.cx + s.r}
            cy={s.cy}
            r={6}
            fill="#fff"
            stroke="#2563EB"
            strokeWidth="2"
            style={{ cursor: "ew-resize" }}
            onPointerDown={(e) => startDrag(e, { kind: "radius", id: s.id })}
          />
        );
      return <g key={s.id}>{els}</g>;
    }
    const pts = s.points;
    const c = pts.length > 2 ? centroid(pts) : { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const ptStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
    if (s.type === "polygon") {
      if (sel)
        els.push(
          <polygon
            key="glow"
            data-ui="1"
            points={ptStr}
            fill="none"
            stroke="#2563EB"
            strokeOpacity="0.3"
            strokeWidth={s.strokeWidth + 6}
          />
        );
      els.push(
        <polygon
          key="p"
          points={ptStr}
          fill={s.fill === "none" ? "transparent" : s.fill}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
          strokeLinejoin="round"
          style={{ cursor: "move" }}
          onPointerDown={(e) => startDrag(e, { kind: "shape", id: s.id })}
        />
      );
    } else {
      if (sel)
        els.push(
          <line
            key="glow"
            data-ui="1"
            x1={pts[0].x}
            y1={pts[0].y}
            x2={pts[1].x}
            y2={pts[1].y}
            stroke="#2563EB"
            strokeOpacity="0.3"
            strokeWidth={s.strokeWidth + 6}
          />
        );
      els.push(
        <line
          key="l"
          x1={pts[0].x}
          y1={pts[0].y}
          x2={pts[1].x}
          y2={pts[1].y}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
          strokeLinecap="round"
          style={{ cursor: "move" }}
          onPointerDown={(e) => startDrag(e, { kind: "shape", id: s.id })}
        />
      );
      els.push(
        <line
          key="hit"
          x1={pts[0].x}
          y1={pts[0].y}
          x2={pts[1].x}
          y2={pts[1].y}
          stroke="transparent"
          strokeWidth="14"
          data-ui="1"
          style={{ cursor: "move" }}
          onPointerDown={(e) => startDrag(e, { kind: "shape", id: s.id })}
        />
      );
    }

    (s.vertexLabels || []).forEach((lbl, i) => {
      if (!lbl || !pts[i]) return;
      const from = s.type === "segment" ? pts[1 - i] : c;
      const pos = away(pts[i], from, 20);
      els.push(
        <text
          key={"v" + i}
          x={pos.x}
          y={pos.y}
          fontSize="19"
          fontFamily="Georgia, serif"
          fontStyle="italic"
          fill={s.stroke}
          textAnchor="middle"
          dominantBaseline="middle"
          pointerEvents="none"
        >
          {lbl}
        </text>
      );
    });

    if (s.type === "polygon")
      (s.sideLabels || []).forEach((lbl, i) => {
        if (!lbl || !pts[i]) return;
        const j = (i + 1) % pts.length;
        const mid = { x: (pts[i].x + pts[j].x) / 2, y: (pts[i].y + pts[j].y) / 2 };
        const pos = away(mid, c, 18);
        els.push(
          <text
            key={"s" + i}
            x={pos.x}
            y={pos.y}
            fontSize="16"
            fontFamily="Georgia, serif"
            fill="#374151"
            textAnchor="middle"
            dominantBaseline="middle"
            pointerEvents="none"
          >
            {lbl}
          </text>
        );
      });

    if (sel)
      pts.forEach((p, i) =>
        els.push(
          <circle
            key={"h" + i}
            data-ui="1"
            cx={p.x}
            cy={p.y}
            r={6}
            fill="#fff"
            stroke="#2563EB"
            strokeWidth="2"
            style={{ cursor: "grab" }}
            onPointerDown={(e) => startDrag(e, { kind: "vertex", id: s.id, vi: i })}
          />
        )
      );
    return <g key={s.id}>{els}</g>;
  };

  const renderMark = (m) => {
    const sel = m.id === selectedId;
    const els = [];
    if (m.type === "angle") {
      const a1 = Math.atan2(m.arm1.y - m.vertex.y, m.arm1.x - m.vertex.x);
      const a2 = Math.atan2(m.arm2.y - m.vertex.y, m.arm2.x - m.vertex.x);
      let d = a2 - a1;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const sweep = d > 0 ? 1 : 0;
      if (m.right) {
        const sz = 13;
        const p1 = { x: m.vertex.x + Math.cos(a1) * sz, y: m.vertex.y + Math.sin(a1) * sz };
        const p2 = { x: m.vertex.x + Math.cos(a2) * sz, y: m.vertex.y + Math.sin(a2) * sz };
        const pc = { x: p1.x + Math.cos(a2) * sz, y: p1.y + Math.sin(a2) * sz };
        els.push(
          <path
            key="sq"
            d={`M ${p1.x} ${p1.y} L ${pc.x} ${pc.y} L ${p2.x} ${p2.y}`}
            fill="none"
            stroke={m.color}
            strokeWidth="1.8"
            pointerEvents="none"
          />
        );
      } else {
        for (let k = 0; k < m.arcs; k++) {
          const r = 20 + k * 6;
          const p1 = { x: m.vertex.x + Math.cos(a1) * r, y: m.vertex.y + Math.sin(a1) * r };
          const p2 = { x: m.vertex.x + Math.cos(a1 + d) * r, y: m.vertex.y + Math.sin(a1 + d) * r };
          els.push(
            <path
              key={"arc" + k}
              d={`M ${p1.x} ${p1.y} A ${r} ${r} 0 0 ${sweep} ${p2.x} ${p2.y}`}
              fill="none"
              stroke={m.color}
              strokeWidth="1.8"
              pointerEvents="none"
            />
          );
        }
      }
      if (m.label) {
        const mid = a1 + d / 2;
        const lr = (m.right ? 24 : 20 + (m.arcs - 1) * 6) + 15;
        els.push(
          <text
            key="lbl"
            x={m.vertex.x + Math.cos(mid) * lr}
            y={m.vertex.y + Math.sin(mid) * lr}
            fontSize="16"
            fontFamily="Georgia, serif"
            fontStyle="italic"
            fill={m.color}
            textAnchor="middle"
            dominantBaseline="middle"
            pointerEvents="none"
          >
            {m.label}
          </text>
        );
      }
      if (sel)
        els.push(
          <circle
            key="glow"
            data-ui="1"
            cx={m.vertex.x}
            cy={m.vertex.y}
            r={26}
            fill="none"
            stroke="#2563EB"
            strokeOpacity="0.35"
            strokeWidth="4"
          />
        );
      els.push(
        <circle
          key="hit"
          data-ui="1"
          cx={m.vertex.x}
          cy={m.vertex.y}
          r={m.right ? 26 : 28 + (m.arcs - 1) * 6}
          fill="transparent"
          style={{ cursor: "move" }}
          onPointerDown={(e) => startDrag(e, { kind: "mark", id: m.id })}
        />
      );
    } else if (m.type === "parallel") {
      const mx = (m.from.x + m.to.x) / 2, my = (m.from.y + m.to.y) / 2;
      const ang = Math.atan2(m.to.y - m.from.y, m.to.x - m.from.x);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const px = Math.cos(ang + Math.PI / 2), py = Math.sin(ang + Math.PI / 2);
      for (let k = 0; k < m.count; k++) {
        const off = (k - (m.count - 1) / 2) * 9;
        const apexX = mx + dx * (off + 5), apexY = my + dy * (off + 5);
        const backX = mx + dx * (off - 4), backY = my + dy * (off - 4);
        els.push(
          <path
            key={"ch" + k}
            d={`M ${backX + px * 6} ${backY + py * 6} L ${apexX} ${apexY} L ${backX - px * 6} ${backY - py * 6}`}
            fill="none"
            stroke={m.color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        );
      }
      if (sel)
        els.push(
          <circle
            key="glow"
            data-ui="1"
            cx={mx}
            cy={my}
            r={18}
            fill="none"
            stroke="#2563EB"
            strokeOpacity="0.35"
            strokeWidth="4"
          />
        );
      els.push(
        <circle
          key="hit"
          data-ui="1"
          cx={mx}
          cy={my}
          r={15}
          fill="transparent"
          style={{ cursor: "move" }}
          onPointerDown={(e) => startDrag(e, { kind: "mark", id: m.id })}
        />
      );
    } else {
      const mx = (m.from.x + m.to.x) / 2, my = (m.from.y + m.to.y) / 2;
      const ang = Math.atan2(m.to.y - m.from.y, m.to.x - m.from.x);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const px = Math.cos(ang + Math.PI / 2), py = Math.sin(ang + Math.PI / 2);
      for (let k = 0; k < m.count; k++) {
        const off = (k - (m.count - 1) / 2) * 7;
        const cx = mx + dx * off, cy = my + dy * off;
        els.push(
          <line
            key={"t" + k}
            x1={cx - px * 6}
            y1={cy - py * 6}
            x2={cx + px * 6}
            y2={cy + py * 6}
            stroke={m.color}
            strokeWidth="2"
            pointerEvents="none"
          />
        );
      }
      if (sel)
        els.push(
          <circle
            key="glow"
            data-ui="1"
            cx={mx}
            cy={my}
            r={18}
            fill="none"
            stroke="#2563EB"
            strokeOpacity="0.35"
            strokeWidth="4"
          />
        );
      els.push(
        <circle
          key="hit"
          data-ui="1"
          cx={mx}
          cy={my}
          r={15}
          fill="transparent"
          style={{ cursor: "move" }}
          onPointerDown={(e) => startDrag(e, { kind: "mark", id: m.id })}
        />
      );
    }
    return <g key={m.id}>{els}</g>;
  };

  const empty = !scene.shapes.length && !(scene.marks || []).length && !scene.annotations.length;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#F3F4F6", fontFamily: "'Segoe UI',system-ui,sans-serif", color: "#111827" }}>
      {/* Top Bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "#111827", flexWrap: "wrap" }}>
        <div style={{ color: "#fff", fontWeight: 800, fontSize: 17, whiteSpace: "nowrap" }}>
          <span style={{ color: "#60A5FA" }}>△</span> Math Diagrammer
        </div>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generate()}
          placeholder={empty ? "Describe a diagram — e.g. two similar triangles ABC and DEF" : "Describe a change or new diagram"}
          style={{ flex: 1, minWidth: 220, padding: "10px 14px", borderRadius: 10, border: "1px solid #374151", background: "#1F2937", color: "#F9FAFB", fontSize: 14, outline: "none" }}
        />
        <button
          onClick={generate}
          disabled={loading || !prompt.trim()}
          style={{ ...btnStyle, background: loading ? "#93C5FD" : "#2563EB", border: "none", color: "#fff", padding: "10px 18px", opacity: !prompt.trim() && !loading ? 0.5 : 1 }}
        >
          {loading ? "Drawing…" : "Generate"}
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Canvas */}
        <div style={{ flex: 1, padding: 16, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid #E5E7EB", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.1)" }}>
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", aspectRatio: "4/3", touchAction: "none", background: "#fff" }}>
              <defs>
                <pattern id="grid" width="25" height="25" patternUnits="userSpaceOnUse">
                  <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#E3EDF4" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width={W} height={H} fill="#fff" onPointerDown={() => setSelectedId(null)} />
              {showGrid && <rect width={W} height={H} fill="url(#grid)" pointerEvents="none" />}
              {scene.shapes.map(renderShape)}
              {(scene.marks || []).map(renderMark)}
              {scene.annotations.map((a) => (
                <g key={a.id}>
                  {a.id === selectedId && (
                    <rect
                      data-ui="1"
                      x={a.x - a.text.length * a.fontSize * 0.3 - 6}
                      y={a.y - a.fontSize * 0.75 - 4}
                      width={a.text.length * a.fontSize * 0.6 + 12}
                      height={a.fontSize * 1.4 + 4}
                      fill="none"
                      stroke="#2563EB"
                      strokeDasharray="4 3"
                      rx="4"
                    />
                  )}
                  <text
                    x={a.x}
                    y={a.y}
                    fontSize={a.fontSize}
                    fill={a.color}
                    fontFamily="Georgia, serif"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ cursor: "move", userSelect: "none" }}
                    onPointerDown={(e) => startDrag(e, { kind: "annotation", id: a.id })}
                  >
                    {a.text}
                  </text>
                </g>
              ))}
            </svg>

            {empty && !loading && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, pointerEvents: "none" }}>
                <div style={{ color: "#9CA3AF", fontSize: 14 }}>Try starting with an example:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 520, pointerEvents: "auto" }}>
                  {EXAMPLES.map((ex) => (
                    <button key={ex} onClick={() => setPrompt(ex)} style={{ ...btnStyle, fontSize: 12.5 }}>
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loading && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.75)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 600, color: "#2563EB" }}>
                Computing exact coordinates…
              </div>
            )}
          </div>
          {error && <div style={{ marginTop: 10, padding: "10px 14px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, color: "#B91C1C", fontSize: 13 }}>{error}</div>}
        </div>

        {/* Sidebar */}
        <div style={{ width: 250, padding: "16px 16px 16px 0", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
          {selectedShape && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Selected {selectedShape.type}</div>
              <div>
                <div style={labelStyle}>Line color</div>
                <Swatches colors={STROKES} value={selectedShape.stroke} onPick={(col) => mutate((s) => { s.shapes.find((x) => x.id === selectedId).stroke = col; })} />
              </div>
              {selectedShape.type !== "segment" && (
                <div>
                  <div style={labelStyle}>Fill</div>
                  <Swatches colors={FILLS} value={selectedShape.fill} onPick={(col) => mutate((s) => { s.shapes.find((x) => x.id === selectedId).fill = col; })} />
                </div>
              )}
              <div>
                <div style={labelStyle}>Line width — {selectedShape.strokeWidth}</div>
                <input type="range" min="1" max="6" step="0.5" value={selectedShape.strokeWidth} style={{ width: "100%" }}
                  onChange={(e) => mutate((s) => { s.shapes.find((x) => x.id === selectedId).strokeWidth = +e.target.value; })} />
              </div>
              {selectedShape.points && (
                <div>
                  <div style={labelStyle}>Vertex labels</div>
                  <input
                    value={(selectedShape.vertexLabels || []).join(",")}
                    onChange={(e) => mutate((s) => { s.shapes.find((x) => x.id === selectedId).vertexLabels = e.target.value.split(","); })}
                    placeholder="A,B,C"
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #D1D5DB", fontSize: 13 }}
                  />
                </div>
              )}
              <button onClick={deleteSelected} style={{ ...btnStyle, color: "#DC2626", borderColor: "#FECACA" }}>Delete shape</button>
            </div>
          )}

          {selectedMark && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Selected {selectedMark.type} mark</div>
              {selectedMark.type === "angle" && !selectedMark.right && (
                <div>
                  <div style={labelStyle}>Arcs — {selectedMark.arcs}</div>
                  <input type="range" min="1" max="3" step="1" value={selectedMark.arcs} style={{ width: "100%" }}
                    onChange={(e) => mutate((s) => { s.marks.find((x) => x.id === selectedId).arcs = +e.target.value; })} />
                </div>
              )}
              {selectedMark.type === "angle" && (
                <div>
                  <div style={labelStyle}>Label</div>
                  <input
                    value={selectedMark.label}
                    onChange={(e) => mutate((s) => { s.marks.find((x) => x.id === selectedId).label = e.target.value; })}
                    placeholder="1, x, 35°…"
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #D1D5DB", fontSize: 13 }}
                  />
                </div>
              )}
              <div>
                <div style={labelStyle}>Color</div>
                <Swatches colors={STROKES} value={selectedMark.color} onPick={(col) => mutate((s) => { s.marks.find((x) => x.id === selectedId).color = col; })} />
              </div>
              <button onClick={deleteSelected} style={{ ...btnStyle, color: "#DC2626", borderColor: "#FECACA" }}>Delete mark</button>
            </div>
          )}

          {selectedAnno && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Selected text</div>
              <input
                value={selectedAnno.text}
                autoFocus
                onChange={(e) => mutate((s) => { s.annotations.find((x) => x.id === selectedId).text = e.target.value; })}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #D1D5DB", fontSize: 13 }}
              />
              <div>
                <div style={labelStyle}>Color</div>
                <Swatches colors={STROKES} value={selectedAnno.color} onPick={(col) => mutate((s) => { s.annotations.find((x) => x.id === selectedId).color = col; })} />
              </div>
              <button onClick={deleteSelected} style={{ ...btnStyle, color: "#DC2626", borderColor: "#FECACA" }}>Delete text</button>
            </div>
          )}

          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={labelStyle}>Tools</div>
            <button onClick={addAnnotation} style={btnStyle}>+ Add text label</button>
            <button onClick={undo} style={btnStyle}>Undo</button>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Show grid
            </label>
            <button
              onClick={() => {
                localStorage.removeItem("md_password");
                alert("Session cleared! You will be prompted for the password on next generate.");
              }}
              style={{ ...btnStyle, fontSize: 12 }}
            >
              🔒 Log out / Change Password
            </button>
            <button onClick={() => { pushHistory(sceneRef.current); setScene(EMPTY_SCENE); setSelectedId(null); }} style={btnStyle}>Clear canvas</button>
          </div>

          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={labelStyle}>Export</div>
            <button onClick={copyToClipboard} style={{ ...btnStyle, background: "#2563EB", color: "#fff", border: "none" }} disabled={empty}>
              📋 Copy for Docs / Word
            </button>
            <button onClick={exportPNG} style={{ ...btnStyle, background: "#111827", color: "#fff", border: "none" }} disabled={empty}>Download PNG</button>
            <button onClick={exportSVG} style={btnStyle} disabled={empty}>Download SVG</button>
          </div>
        </div>
      </div>
    </div>
  );
}
