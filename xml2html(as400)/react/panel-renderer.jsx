import React, { useMemo, useState, useRef, useCallback, useEffect } from "react";

/* =========================================================================
   1. XML -> JSON schema (parse once)
   ========================================================================= */

function xmlNodeToJson(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent.trim();
    return t ? t : null;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const attrs = {};
  for (const a of node.attributes) attrs[a.name] = a.value;

  const children = [];
  let text = "";
  for (const child of node.childNodes) {
    if (child.nodeType === Node.COMMENT_NODE) continue;
    const parsed = xmlNodeToJson(child);
    if (parsed === null) continue;
    if (typeof parsed === "string") {
      text += (text ? " " : "") + parsed;
    } else {
      children.push(parsed);
    }
  }

  return { tag: node.tagName, attrs, text: text || undefined, children };
}

function parsePanelXml(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, "text/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("XML parse error: " + err.textContent);
  return xmlNodeToJson(doc.documentElement);
}

// convenience: get first child by tag
const child = (node, tag) => node?.children?.find((c) => c.tag === tag);
const childrenOf = (node, tag) => node?.children?.filter((c) => c.tag === tag) || [];

/* =========================================================================
   2. Coordinate system: character-cell units -> px
   ========================================================================= */

const CELL_W = 7.6; // px per horizontal unit (tuned for monospace-ish density)
const CELL_H = 22; // px per vertical unit

function posStyle(node) {
  const pos = child(node, "Pos");
  if (!pos) return {};
  const { l, t, w, h } = pos.attrs;
  const style = { position: "absolute" };
  if (l !== undefined) style.left = parseFloat(l) * CELL_W;
  if (t !== undefined) style.top = parseFloat(t) * CELL_H;
  if (w) style.width = parseFloat(w) * CELL_W;
  if (h && parseFloat(h) > 0) style.height = parseFloat(h) * CELL_H;
  return style;
}

/* =========================================================================
   3. Central command dispatcher (onClick="runCommand('KEY','F09')" etc.)
   ========================================================================= */

function useCommandDispatcher(onLog) {
  return useCallback(
    (exprString, ctx = {}) => {
      if (!exprString) return;
      // naive parse: functionName('arg1','arg2')
      const m = exprString.match(/^(\w+)\((.*)\)$/);
      if (!m) return;
      const [, fn, argStr] = m;
      const args = argStr
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
      onLog(`${fn}(${args.join(", ")})`, ctx);
    },
    [onLog]
  );
}

/* =========================================================================
   4. Component registry: tag -> renderer
   ========================================================================= */

function Cap({ node }) {
  return (
    <div className="pf-cap" style={posStyle(node)}>
      {node.text}
    </div>
  );
}

function Btn({ node, dispatch }) {
  const attrs = node.attrs;
  return (
    <button
      className="pf-btn"
      style={posStyle(node)}
      disabled={attrs.acc === "WD"}
      onClick={() => dispatch(attrs.onClick, { name: attrs.name })}
    >
      {node.text || attrs.name}
    </button>
  );
}

function EFld({ node, dispatch }) {
  const attrs = node.attrs;
  const constr = child(node, "Constr");
  const proposals = child(node, "Proposals");
  const [value, setValue] = useState(attrs.val || "");
  const [showProposals, setShowProposals] = useState(false);

  const maxLength = constr?.attrs.maxL ? parseInt(constr.attrs.maxL, 10) : undefined;
  const inputMode = constr?.attrs.type === "DECIMAL" ? "decimal" : "text";
  const disabled = attrs.acc === "WD";

  return (
    <div className="pf-efld-wrap" style={posStyle(node)}>
      <input
        className="pf-efld"
        name={attrs.name}
        value={value}
        maxLength={maxLength}
        inputMode={inputMode}
        disabled={disabled}
        data-type={constr?.attrs.type}
        onChange={(e) => {
          let v = e.target.value;
          if (constr?.attrs.uc === "UC") v = v.toUpperCase();
          setValue(v);
          if (proposals && v.length >= parseInt(proposals.attrs.minChar || "1", 10)) {
            setShowProposals(true);
          } else {
            setShowProposals(false);
          }
        }}
        onKeyUp={() => dispatch(attrs.onKeyUp, { name: attrs.name, value })}
      />
      {showProposals && proposals && (
        <div className="pf-proposals">
          fetching {dataUrlOf(proposals)} … (debounce {proposals.attrs.delay}ms)
        </div>
      )}
    </div>
  );
}

function dataUrlOf(proposalsNode) {
  return child(proposalsNode, "dataURL")?.text || "";
}

function CBoxField({ node, dispatch }) {
  const attrs = node.attrs;
  const options = childrenOf(node, "CBV");
  const [value, setValue] = useState(attrs.val || "");
  return (
    <select
      className="pf-cbox"
      style={posStyle(node)}
      name={attrs.name}
      value={value}
      disabled={attrs.acc === "WD"}
      onChange={(e) => {
        setValue(e.target.value);
        dispatch(attrs.onChange, { name: attrs.name, value: e.target.value });
      }}
    >
      {options.map((o, i) => (
        <option key={i} value={o.attrs.val}>
          {o.text || o.attrs.val}
        </option>
      ))}
    </select>
  );
}

function ChkBoxField({ node, dispatch }) {
  const attrs = node.attrs;
  const [checked, setChecked] = useState(false);
  return (
    <input
      type="checkbox"
      className="pf-chkbox"
      style={posStyle(node)}
      name={attrs.name}
      checked={checked}
      onChange={(e) => {
        setChecked(e.target.checked);
        dispatch(attrs.onChange, { name: attrs.name, value: e.target.checked });
      }}
    />
  );
}

// registry maps XML tag -> component
const REGISTRY = {
  Cap,
  Btn,
  EFld,
  CBox: CBoxField,
  ChkBox: ChkBoxField,
};

function RenderNode({ node, dispatch }) {
  const Comp = REGISTRY[node.tag];
  if (!Comp) return null;
  return <Comp node={node} dispatch={dispatch} />;
}

/* =========================================================================
   5. Virtualized List (manual windowing, no external lib)
   ========================================================================= */

const ROW_H = 32;
const VIEWPORT_H = 340;
const OVERSCAN = 6;

function mockRows(cols, count) {
  // LRows was empty in the sample XML -- generate demo data
  const rows = [];
  for (let i = 0; i < count; i++) {
    const row = {};
    cols.forEach((c) => {
      const name = c.attrs.name;
      if (name === "D1SHID") row[name] = 100000 + i;
      else if (name === "D1RESP") row[name] = "USER" + (i % 7);
      else if (name === "D1ORST") row[name] = [10, 50, 90][i % 3];
      else if (name === "D1WHLO") row[name] = "WH" + (i % 3);
      else if (name === "D1SHDT" || name === "D1PDDT" || name === "D1DEDT")
        row[name] = "2026-0" + ((i % 9) + 1) + "-15";
      else row[name] = "";
    });
    return row; // eslint-disable-line no-unreachable
  }
  return rows;
}

function buildMockRows(cols, count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const row = { _id: i };
    cols.forEach((c) => {
      const name = c.attrs.name;
      if (name === "D1SHID") row[name] = 100000 + i;
      else if (name === "D1RESP") row[name] = "USER" + (i % 7);
      else if (name === "D1ORST") row[name] = [10, 50, 90][i % 3];
      else if (name === "D1WHLO") row[name] = "WH" + (i % 3);
      else if (["D1SHDT", "D1PDDT", "D1DPDT", "D1DEDT"].includes(name))
        row[name] = `2026-0${(i % 9) + 1}-15`;
      else if (name === "D6CUNO") row[name] = 5000 + i;
      else if (name === "D6CUNM") row[name] = "Customer " + i;
      else if (name === "D1FWID") row[name] = "FWD" + (i % 4);
      else if (name === "D1TRTY") row[name] = ["SEA", "AIR", "ROAD"][i % 3];
      else if (["D1CRAM", "D1DETM", "D1PERF"].includes(name))
        row[name] = (i * 1.37).toFixed(2);
      else row[name] = "";
    });
    rows.push(row);
  }
  return rows;
}

function VirtualList({ node }) {
  const lview = child(node, "LView");
  const lcols = childrenOf(child(lview, "LCols"), "LCol");
  const totalRows = 5000; // simulate a large dataset
  const data = useMemo(() => buildMockRows(lcols, totalRows), [lcols]);

  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const visibleCount = Math.ceil(VIEWPORT_H / ROW_H) + OVERSCAN * 2;
  const endIndex = Math.min(data.length, startIndex + visibleCount);
  const visibleRows = data.slice(startIndex, endIndex);

  const totalHeight = data.length * ROW_H;
  const offsetY = startIndex * ROW_H;

  return (
    <div className="pf-list-wrap">
      <div className="pf-list-header" style={{ display: "flex" }}>
        {lcols.map((c) => (
          <div
            key={c.attrs.name}
            className="pf-list-th"
            style={{ width: parseFloat(c.attrs.w) * 9, textAlign: c.attrs.just === "C" ? "center" : "left" }}
            title={c.attrs.ttip}
          >
            {child(c, "Cap")?.text || c.attrs.name}
          </div>
        ))}
      </div>
      <div
        className="pf-list-body"
        ref={scrollRef}
        style={{ height: VIEWPORT_H, overflowY: "auto", position: "relative" }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div style={{ height: totalHeight, position: "relative" }}>
          <div style={{ position: "absolute", top: offsetY, left: 0, right: 0 }}>
            {visibleRows.map((row) => (
              <div key={row._id} className="pf-list-row" style={{ display: "flex", height: ROW_H }}>
                {lcols.map((c) => (
                  <div
                    key={c.attrs.name}
                    className="pf-list-td"
                    style={{ width: parseFloat(c.attrs.w) * 9, textAlign: c.attrs.just === "C" ? "center" : "left" }}
                  >
                    {row[c.attrs.name]}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="pf-list-footer">
        rendering rows {startIndex + 1}–{endIndex} of {data.length.toLocaleString()} (only {visibleRows.length} DOM rows exist)
      </div>
    </div>
  );
}

/* =========================================================================
   6. Panel shell: FKeys toolbar + Body + List
   ========================================================================= */

function FKeysBar({ node, dispatch }) {
  const fkeys = childrenOf(node, "FKey");
  return (
    <div className="pf-fkeys">
      {fkeys.map((f, i) => (
        <button key={i} className="pf-fkey" onClick={() => dispatch(`runCommand('KEY','${f.attrs.val}')`)}>
          <span className="pf-fkey-code">{f.attrs.val}</span>
          {f.text}
        </button>
      ))}
    </div>
  );
}

function Panel({ schema }) {
  const [log, setLog] = useState([]);
  const dispatch = useCommandDispatcher((entry) =>
    setLog((prev) => [entry, ...prev].slice(0, 6))
  );

  const panel = child(schema, "Panel");
  const objs = child(panel, "Objs");
  const fkeys = child(objs, "FKeys");
  const body = child(objs, "Body");
  const list = child(objs, "List");

  const bodyHeight = Math.max(...body.children.map((n) => {
    const p = child(n, "Pos");
    return p ? parseFloat(p.attrs.t || 0) : 0;
  })) * CELL_H + 60;

  return (
    <div className="pf-panel">
      <div className="pf-panel-head">
        <div>
          <div className="pf-panel-title">{child(panel, "PDesc")?.text}</div>
          <div className="pf-panel-sub">{child(panel, "PHead")?.text}</div>
        </div>
        <FKeysBar node={fkeys} dispatch={dispatch} />
      </div>

      <div className="pf-body" style={{ height: bodyHeight }}>
        {body.children.map((n, i) => (
          <RenderNode key={i} node={n} dispatch={dispatch} />
        ))}
      </div>

      <VirtualList node={list} />

      <div className="pf-log">
        <div className="pf-log-title">command log</div>
        {log.length === 0 && <div className="pf-log-empty">interact with a field or button…</div>}
        {log.map((l, i) => (
          <div key={i} className="pf-log-line">→ {l}</div>
        ))}
      </div>
    </div>
  );
}

/* =========================================================================
   7. Sample XML (from the brief) + App
   ========================================================================= */

const SAMPLE_XML = `<Panels>
  <Panel>
    <PDesc>Shipments</PDesc>
    <PHead>DRX600/B2</PHead>
    <Objs>
      <FKeys val="001010000001000000000000">
        <FKey val="F3">Close</FKey>
        <FKey val="F5">Refresh</FKey>
        <FKey val="F12">Cancel</FKey>
      </FKeys>
      <Body>
        <Btn name="CREATE" acc="WE" onClick="runCommand('KEY','NEW');">
          <Pos l="2" t="2" w="10" h="1.5"></Pos>
          Create
        </Btn>
        <Cap styleclass="1"><Pos l="17" t="2" w="" h="" />Created By</Cap>
        <EFld name="B_PCUSID" val="" acc="WE" onKeyUp="resetName('B_PCNAME');">
          <Proposals selectMandatory="false" delay="750" minChar="3" maxProposals="5">
            <dataURL>/mwp/webservice/query/USER</dataURL>
          </Proposals>
          <Pos l="30" t="2" w="10" h="0" />
          <Constr maxL="10" type="CHAR" uc="UC" />
        </EFld>
        <Btn name="B_SEARCH" acc="WE" onClick="runCommand('KEY', 'F09');">??<Pos l="39.6" t="2"></Pos></Btn>
        <EFld name="B_PCNAME" acc="WD" val="">
          <Pos l="41.8" t="2" w="16" h="0" />
          <Constr maxL="40" type="CHAR" />
        </EFld>
        <Cap styleclass="1"><Pos l="17" t="3" h="" w="" />Status From</Cap>
        <CBox name="B_D1ORST1" val="" acc="WE" onChange="runCommand('KEY','ENTER')">
          <Pos l="30" t="3" w="20"></Pos>
          <CBV val="">-</CBV>
          <CBV val="10">10=Shipment created</CBV>
          <CBV val="50">50=Export completed</CBV>
          <CBV val="90">90=Import completed</CBV>
        </CBox>
        <Cap styleclass="1"><Pos l="48" t="3" h="" w="" />to</Cap>
        <CBox name="B_D1ORST2" val="" acc="WE" onChange="runCommand('KEY','ENTER')">
          <Pos l="50.4" t="3" w="20"></Pos>
          <CBV val="">-</CBV>
          <CBV val="10">10=Shipment created</CBV>
          <CBV val="50">50=Export completed</CBV>
          <CBV val="90">90=Import completed</CBV>
        </CBox>
        <Cap styleclass="1"><Pos l="17" t="4" h="" w="" />Shipment Date From</Cap>
        <EFld name="B_D1SHDT1" val="" acc="WE">
          <Pos l="30" t="4" w="9"></Pos>
          <Constr type="DATE" maxL="10"></Constr>
        </EFld>
        <Cap styleclass="1"><Pos l="39" t="4" h="" w="" />to</Cap>
        <EFld name="B_D1SHDT2" val="" acc="WE">
          <Pos l="41.4" t="4" w="9"></Pos>
          <Constr type="DATE" maxL="10"></Constr>
        </EFld>
        <Cap styleclass="1"><Pos l="74" t="2" h="" w="" />Receiving Country</Cap>
        <CBox name="B_D6CSCD" val="" acc="WE" onChange="runCommand('KEY','ENTER')">
          <Pos l="85.2" t="2" w="15"></Pos>
          <CBV val="-1">-</CBV>
        </CBox>
        <Cap styleclass="1"><Pos l="74" t="3" h="" w="" />Forwarder</Cap>
        <CBox name="B_D1FWID" val="" acc="WE" onChange="runCommand('KEY','ENTER')">
          <Pos l="85.2" t="3" w="15"></Pos>
          <CBV val="-1">-</CBV>
        </CBox>
        <Cap styleclass="1"><Pos l="74" t="4" h="" w="" />Transport Type</Cap>
        <CBox name="B_D1TRTY" val="" acc="WE" onChange="runCommand('KEY','ENTER')">
          <Pos l="85.2" t="4" w="15"></Pos>
          <CBV val="-1">-</CBV>
        </CBox>
        <Cap styleclass="1"><Pos l="101" t="2" h="" w="" />Delivery</Cap>
        <EFld name="B_D2DLIX" val="" acc="WE" filter="true">
          <Pos l="107" t="2" w="9"></Pos>
          <Constr type="DECIMAL" maxL="11"></Constr>
        </EFld>
        <Btn name="EXPORTER" acc="WE" onClick="runCommand('KEY','F06');">Exporter<Pos l="2" t="5.2" w="15" h="2"></Pos></Btn>
        <Btn name="IMPORTER" acc="WD" onClick="runCommand('KEY','F07');">Importer<Pos l="18" t="5.2" w="15" h="2"></Pos></Btn>
        <Cap>Preference<Pos l="34" t="5.2" w="10" h="0" /></Cap>
        <ChkBox name="VALIDAG" value="1" onChange="runCommand('KEY','ENTER');"><Pos l="41.5" t="5.2" /></ChkBox>
      </Body>
      <List scroll="0" nrOfRows="18" resizeList="19" resizeNrOfRows="21" isEditable="true">
        <Pos l="2" t="6.9" w="80" h="16" />
        <LView>
          <LCols>
            <LCol name="D1SHID" w="7.5" ttip="Shipment Id"><Cap>Shipment Id</Cap></LCol>
            <LCol name="D1RESP" w="13" ttip="Created By"><Cap>Created By</Cap></LCol>
            <LCol name="D1WHLO" w="11" ttip="Sending Warehouse"><Cap>Sending Warehouse</Cap></LCol>
            <LCol name="D1ORST" w="4.4" ttip="Status" just="C"><Cap>Status</Cap></LCol>
            <LCol name="D6CUNO" w="7.8" ttip="Customer No"><Cap>Customer No</Cap></LCol>
            <LCol name="D6CUNM" w="19" ttip="Customer Name"><Cap>Customer Name</Cap></LCol>
            <LCol name="D1FWID" w="12" ttip="Forwarder"><Cap>Forwarder</Cap></LCol>
            <LCol name="D1TRTY" w="8.4" ttip="Transport Type"><Cap>Transport Type</Cap></LCol>
            <LCol name="D1SHDT" w="8" ttip="Shipping Date" just="C"><Cap>Shipping Date</Cap></LCol>
            <LCol name="D1PDDT" w="10" ttip="Planned Delivery date" just="C"><Cap>Planned Delivery date</Cap></LCol>
          </LCols>
          <LRows></LRows>
        </LView>
      </List>
    </Objs>
  </Panel>
</Panels>`;

export default function App() {
  const schema = useMemo(() => parsePanelXml(SAMPLE_XML), []);

  return (
    <div className="pf-app">
      <style>{CSS}</style>
      <div className="pf-app-header">
        <div className="pf-app-title">Panel Schema Renderer</div>
        <div className="pf-app-desc">
          XML → JSON schema → component registry → virtualized list. {" "}
          <code>5,000</code> mock rows, only ~<code>{Math.ceil(VIEWPORT_H / ROW_H) + OVERSCAN * 2}</code> ever in the DOM.
        </div>
      </div>
      <Panel schema={schema} />
    </div>
  );
}

/* =========================================================================
   8. Styling
   ========================================================================= */

const CSS = `
  .pf-app { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: #1c2321; background: #f6f5f1; padding: 20px; border-radius: 10px; }
  .pf-app-header { margin-bottom: 14px; }
  .pf-app-title { font-size: 15px; font-weight: 700; letter-spacing: 0.02em; }
  .pf-app-desc { font-size: 12px; color: #6b7570; margin-top: 3px; }
  .pf-app-desc code { background: #e7e4da; padding: 1px 5px; border-radius: 3px; }

  .pf-panel { background: #ffffff; border: 1px solid #d8d5c9; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
  .pf-panel-head { display: flex; justify-content: space-between; align-items: flex-start; padding: 12px 16px; background: #1c2321; color: #f6f5f1; }
  .pf-panel-title { font-size: 14px; font-weight: 700; }
  .pf-panel-sub { font-size: 11px; color: #9aa39c; margin-top: 2px; }

  .pf-fkeys { display: flex; gap: 6px; }
  .pf-fkey { display: flex; align-items: center; gap: 5px; background: #2d3630; border: 1px solid #454f47; color: #f6f5f1; font-size: 11px; padding: 4px 8px; border-radius: 4px; cursor: pointer; }
  .pf-fkey:hover { background: #454f47; }
  .pf-fkey-code { background: #b8622f; color: white; font-size: 10px; padding: 1px 4px; border-radius: 2px; font-weight: 700; }

  .pf-body { position: relative; background: #fbfaf7; border-bottom: 1px solid #e5e2d6; }

  .pf-cap { font-size: 11.5px; color: #4a534d; padding-top: 3px; white-space: nowrap; }
  .pf-btn { background: #ffffff; border: 1px solid #c9c5b6; border-radius: 4px; font-size: 11.5px; cursor: pointer; padding: 0 8px; }
  .pf-btn:hover:not(:disabled) { background: #eeece3; border-color: #b8622f; }
  .pf-btn:disabled { color: #a8a8a0; cursor: not-allowed; }

  .pf-efld-wrap { position: relative; }
  .pf-efld { width: 100%; height: 100%; font-size: 11.5px; border: 1px solid #c9c5b6; border-radius: 3px; padding: 0 5px; font-family: inherit; box-sizing: border-box; background: #fff; }
  .pf-efld:focus { outline: none; border-color: #b8622f; box-shadow: 0 0 0 2px rgba(184,98,47,0.15); }
  .pf-efld:disabled { background: #f1efe8; color: #8a8a80; }
  .pf-proposals { position: absolute; top: 100%; left: 0; background: #1c2321; color: #d8d5c9; font-size: 10.5px; padding: 4px 6px; border-radius: 3px; white-space: nowrap; z-index: 5; }

  .pf-cbox { font-size: 11.5px; border: 1px solid #c9c5b6; border-radius: 3px; height: 22px; font-family: inherit; }
  .pf-cbox:disabled { background: #f1efe8; }

  .pf-list-wrap { border-top: 1px solid #e5e2d6; }
  .pf-list-header { background: #eeece3; border-bottom: 1px solid #d8d5c9; font-size: 10.5px; font-weight: 700; color: #4a534d; }
  .pf-list-th, .pf-list-td { padding: 6px 8px; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
  .pf-list-row { font-size: 11.5px; border-bottom: 1px solid #f0efe8; align-items: center; }
  .pf-list-row:hover { background: #fbf3ec; }
  .pf-list-footer { font-size: 10.5px; color: #8a9088; padding: 5px 8px; background: #f1efe8; }

  .pf-log { padding: 8px 16px; background: #1c2321; color: #d8d5c9; font-size: 11px; min-height: 90px; }
  .pf-log-title { color: #6f7a72; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.08em; margin-bottom: 4px; }
  .pf-log-empty { color: #57605a; font-style: italic; }
  .pf-log-line { color: #e8b587; padding: 1px 0; }
`;
