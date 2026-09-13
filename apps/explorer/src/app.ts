import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ReputationClient } from "@verity/indexer";
import type { DemoRunner } from "./demo-runner.js";

export function createExplorerServer(client: ReputationClient, demo?: DemoRunner) {
  const handler = createExplorerHandler(client, demo);
  return createServer(handler);
}

export function createExplorerHandler(client: ReputationClient, demo?: DemoRunner) {
  return async (request: Pick<IncomingMessage, "url" | "method">, response: ServerResponse) => {
    const path = request.url?.split("?", 1)[0] ?? "/";
    if (path === "/" || path === "/index.html") {
      writeHtml(response, 200, explorerPage);
      return;
    }
    if (path === "/health") {
      writeJson(response, 200, { status: "ok", source: "graph" });
      return;
    }
    const query = new URLSearchParams(request.url?.split("?", 2)[1] ?? "");
    try {
      if (path === "/demo/honest") {
        if (request.method !== "POST") return writeJson(response, 405, { error: "method_not_allowed" });
        if (!demo) return writeJson(response, 503, { error: "interactive_demo_unavailable" });
        writeJson(response, 200, await demo.runHonestPurchase());
        return;
      }
      if (path === "/provider") {
        const agentId = query.get("agentId");
        if (!agentId) return writeJson(response, 400, { error: "agentId_required" });
        writeJson(response, 200, await client.provider(agentId));
        return;
      }
      if (path === "/buyer") {
        const root = query.get("root");
        if (!root) return writeJson(response, 400, { error: "root_required" });
        writeJson(response, 200, await client.buyer(root));
        return;
      }
      writeJson(response, 404, { error: "not_found" });
    } catch (error) {
      writeJson(response, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function writeHtml(response: ServerResponse, statusCode: number, value: string): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(value);
}

const explorerPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Verity reputation explorer</title>
    <meta name="description" content="Pay-per-correct-answer settlement and two-sided reputation for AI agents on Hedera.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #07100e; color: #f2fff9; --mint: #61e8b5; --line: #29473e; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; overflow-x: hidden; background: radial-gradient(circle at 85% 0, #17493d 0, transparent 36%), radial-gradient(circle at 0 70%, #172d56 0, transparent 35%), #07100e; }
      body::before { content: ''; position: fixed; inset: 0; pointer-events: none; opacity: .22; background-image: linear-gradient(#ffffff09 1px, transparent 1px), linear-gradient(90deg, #ffffff09 1px, transparent 1px); background-size: 48px 48px; mask-image: linear-gradient(to bottom, black, transparent 75%); }
      main { width: min(1080px, calc(100% - 32px)); margin: 0 auto; padding: 52px 0 72px; }
      nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 72px; }
      .brand { display: flex; align-items: center; gap: 10px; font-family: 'Space Grotesk', sans-serif; font-size: 1.05rem; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
      .mark { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid #73eac0; border-radius: 9px; background: #173d31; box-shadow: inset 0 0 18px #61e8b522; color: var(--mint); letter-spacing: 0; }
      .live { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid #2d6b59; border-radius: 999px; background: #0d211bcc; color: #a9f4d2; font-size: .78rem; font-weight: 700; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #61e8b5; box-shadow: 0 0 16px #61e8b5; }
      .eyebrow { margin: 0 0 12px; color: #61e8b5; font-size: .78rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
      .hero { display: grid; grid-template-columns: 1.25fr .75fr; gap: 54px; align-items: center; }
      h1 { margin: 0 0 18px; max-width: 760px; font-family: 'Space Grotesk', sans-serif; font-size: clamp(3rem, 7vw, 6.3rem); line-height: .94; letter-spacing: -0.065em; }
      h1 em { color: var(--mint); font-style: normal; }
      p { color: #a8bdb5; line-height: 1.65; max-width: 700px; }
      .flow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 28px; color: #b8cec5; font-size: .86rem; }
      .flow span { padding: 8px 11px; border: 1px solid #29473e; border-radius: 8px; background: #0b1815; }
      .flow b { color: #61e8b5; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-top: 36px; }
      .demo { margin-top: 54px; padding: 28px; border: 1px solid #4a806e; border-radius: 22px; background: linear-gradient(135deg, #112b23e8, #0a1613e8); box-shadow: 0 28px 90px #02080799; }
      .demo-head { display: flex; align-items: end; justify-content: space-between; gap: 24px; }
      .demo h2 { margin: 0 0 8px; font-family: 'Space Grotesk', sans-serif; font-size: clamp(1.7rem, 4vw, 2.7rem); letter-spacing: -.04em; }
      .demo p { margin: 0; }
      .demo button { min-width: 210px; padding: 15px 20px; box-shadow: 0 12px 36px #61e8b52c; }
      .demo button:disabled { cursor: wait; opacity: .6; }
      .demo-result { display: none; margin-top: 22px; }
      .demo-result.visible { display: block; }
      .live-receipt-card { position: relative; padding: 22px; border: 1px solid #5adcae; border-radius: 16px; background: #071511; box-shadow: inset 0 1px #ffffff12; animation: receipt-in .45s cubic-bezier(.2,.8,.25,1) both; }
      .live-receipt-card::after { content: '✓'; position: absolute; top: 18px; right: 22px; display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid #61e8b5; border-radius: 50%; color: #61e8b5; font-size: 1.2rem; }
      .signed-label { color: #61e8b5; font-size: .68rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
      .settled-label { margin: 20px 0 4px; color: #effff8; font-family: 'Space Grotesk', sans-serif; font-size: 2rem; font-weight: 700; letter-spacing: -.04em; }
      .receipt-note { margin: 0 42px 20px 0; color: #9fc5b7; font-size: .8rem; }
      .live-receipt-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin: 0 0 18px; border: 1px solid #29473e; border-radius: 10px; overflow: hidden; background: #29473e; }
      .live-receipt-grid div { min-width: 0; padding: 12px; background: #0b1b16; color: #77958a; font-size: .68rem; }
      .live-receipt-grid strong { display: block; margin-top: 5px; overflow: hidden; color: #eafff7; font-size: .78rem; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
      .receipt-proof-links { display: flex; flex-wrap: wrap; gap: 8px; }
      .receipt-proof-links a { padding: 9px 11px; border: 1px solid #326b58; border-radius: 8px; background: #0d211b; font-size: .74rem; font-weight: 700; text-decoration: none; }
      .demo-error { color: #ffb4a8; }
      .proof-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; overflow: hidden; margin-top: 22px; border: 1px solid #29473e; border-radius: 12px; background: #29473e; }
      .proof-strip div { padding: 13px; background: #081310; color: #819b91; font-size: .7rem; }
      .proof-strip strong { display: block; margin-top: 4px; color: #eafff7; font-size: .78rem; }
      .receipt { position: relative; padding: 24px; border: 1px solid #315a4c; border-radius: 22px; background: linear-gradient(145deg, #10251fdd, #081310ee); box-shadow: 0 30px 100px #020706, inset 0 1px #ffffff12; transform: rotate(2deg); animation: float 5s ease-in-out infinite; }
      .receipt::before { content: ''; position: absolute; inset: -1px; border-radius: inherit; padding: 1px; background: linear-gradient(130deg, #78efc1, transparent 42%); mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0); pointer-events: none; }
      .receipt-head { display: flex; justify-content: space-between; align-items: center; color: #819b91; font-size: .7rem; font-weight: 700; letter-spacing: .11em; text-transform: uppercase; }
      .verdict { margin: 34px 0 6px; font-family: 'Space Grotesk', sans-serif; font-size: 2.6rem; font-weight: 700; color: var(--mint); }
      .receipt-row { display: flex; justify-content: space-between; gap: 16px; padding: 13px 0; border-top: 1px solid #233c34; color: #91aaa0; font-size: .78rem; }
      .receipt-row strong { color: #eafff7; font-weight: 600; text-align: right; }
      .pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--mint); animation: pulse 1.8s ease-out infinite; }
      .principles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 72px 0 12px; }
      .principle { padding: 18px; border-left: 1px solid var(--line); }
      .principle b { display: block; margin-bottom: 6px; font-family: 'Space Grotesk', sans-serif; font-size: 1rem; }
      .principle span { color: #829a91; font-size: .78rem; line-height: 1.5; }
      .sdk-proof { display: grid; grid-template-columns: .82fr 1.18fr; gap: 24px; align-items: stretch; margin-top: 36px; padding: 24px; border: 1px solid #315a4c; border-radius: 18px; background: linear-gradient(135deg, #10241fd9, #091411e8); }
      .sdk-proof h2 { margin: 0 0 8px; font-family: 'Space Grotesk', sans-serif; font-size: clamp(1.5rem, 3vw, 2.2rem); letter-spacing: -.04em; }
      .sdk-proof p { margin: 0; font-size: .86rem; }
      .sdk-code { margin: 0; min-height: 0; border: 1px solid #29473e; color: #d8fff0; }
      .sdk-code .accent { color: #61e8b5; }
      .sdk-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
      .sdk-pills span { padding: 7px 9px; border: 1px solid #326b58; border-radius: 999px; color: #a9f4d2; font-size: .68rem; font-weight: 700; }
      section { padding: 24px; border: 1px solid #29473e; border-radius: 18px; background: #0c1916dd; box-shadow: 0 22px 70px #02080788; backdrop-filter: blur(14px); transition: transform .25s ease, border-color .25s ease; }
      section:hover { transform: translateY(-3px); border-color: #477968; }
      section h2 { margin: 0 0 6px; font-size: 1.12rem; }
      section p { margin: 0 0 22px; font-size: .86rem; }
      label { display: block; margin-bottom: 8px; color: #a8bdb5; font-size: 0.8rem; font-weight: 700; }
      .controls { display: flex; gap: 8px; }
      input { min-width: 0; width: 100%; padding: 12px; border: 1px solid #365e51; border-radius: 9px; background: #07100e; color: #f2fff9; outline: none; }
      input:focus { border-color: #61e8b5; box-shadow: 0 0 0 3px #61e8b51a; }
      button { flex: 0 0 auto; padding: 11px 15px; border: 0; border-radius: 9px; background: #61e8b5; color: #06120e; font-weight: 800; cursor: pointer; }
      button:hover { background: #8cf2cc; }
      pre { min-height: 76px; margin: 18px 0 0; padding: 14px; overflow: auto; white-space: pre-wrap; border-radius: 10px; background: #06100d; color: #cae3da; font-size: .78rem; }
      .status { margin-top: 22px; color: #83dcb9; font-size: .82rem; }
      a, code { color: #61e8b5; }
      .reveal { animation: rise .7s cubic-bezier(.2,.75,.25,1) both; }
      .delay-1 { animation-delay: .1s; } .delay-2 { animation-delay: .2s; }
      @keyframes rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes float { 0%,100% { transform: rotate(2deg) translateY(0); } 50% { transform: rotate(1deg) translateY(-8px); } }
      @keyframes pulse { 0% { box-shadow: 0 0 0 0 #61e8b566; } 70%,100% { box-shadow: 0 0 0 10px #61e8b500; } }
      @keyframes receipt-in { from { opacity: 0; transform: translateY(8px) scale(.99); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @media (prefers-reduced-motion: reduce) { *, *::before { animation: none !important; transition: none !important; } }
      @media (max-width: 760px) { nav { margin-bottom: 48px; } .hero { grid-template-columns: 1fr; } .receipt { transform: none; } .principles { grid-template-columns: 1fr; margin-top: 48px; } .sdk-proof { grid-template-columns: 1fr; } .demo-head { align-items: stretch; flex-direction: column; } .proof-strip { grid-template-columns: 1fr 1fr; } .controls { flex-direction: column; } button { width: 100%; } }
    </style>
  </head>
  <body>
    <main>
      <nav class="reveal"><div class="brand"><span class="mark">V</span>Verity</div><a class="live" href="/health"><span class="dot"></span>Live Graph index</a></nav>
      <div class="hero">
        <div class="reveal delay-1">
          <p class="eyebrow">Pay only when the answer is correct</p>
          <h1>Trust, resolved <em>in public.</em></h1>
          <p>Verity holds x402 settlement until an AI response passes a deterministic check. Wrong answers are refused, disputes are replayable, and both sides earn portable reputation.</p>
          <div class="flow"><span>402 challenge</span><b>→</b><span>deliver</span><b>→</b><span>verify</span><b>→</b><span>settle or dispute</span><b>→</b><span>HCS receipt</span></div>
        </div>
        <aside class="receipt reveal delay-2" aria-label="Example verified settlement receipt">
          <div class="receipt-head"><span>Deterministic verdict</span><span class="pulse"></span></div>
          <div class="verdict">ACCEPT</div>
          <p>Answer matched the published rule. Payment may settle.</p>
          <div class="receipt-row"><span>Settlement</span><strong>Hedera testnet</strong></div>
          <div class="receipt-row"><span>Audit trail</span><strong>HCS + Mirror Node</strong></div>
          <div class="receipt-row"><span>Reputation</span><strong>ERC-8004 / Agent0</strong></div>
        </aside>
      </div>
      <div class="principles reveal delay-2">
        <div class="principle"><b>Delivery first</b><span>The buyer evaluates the real response before value moves.</span></div>
        <div class="principle"><b>Mechanically correct</b><span>Published rules—not model opinion—decide settlement.</span></div>
        <div class="principle"><b>Replay anywhere</b><span>Mirror Node and content hashes reproduce every verdict.</span></div>
      </div>
      <section class="sdk-proof reveal delay-2" aria-label="Verity SDK quickstart">
        <div>
          <p class="eyebrow">Two-line integration</p>
          <h2>Keep your API. Add a verdict.</h2>
          <p>One wrapper protects an existing x402 handler. The provider chooses a published rule; Verity handles the challenge, delivery-first flow, and evidence.</p>
          <div class="sdk-pills"><span>NO RESTRUCTURING</span><span>DETERMINISTIC</span><span>HEDERA TESTNET</span></div>
        </div>
        <pre class="sdk-code"><span class="accent">import</span> { protect } <span class="accent">from</span> '@jennycruzy/verity';

<span class="accent">const</span> handler = protect(app, {
  price: '1000000',
  verifier: 'fx-rate-v1'
});</pre>
      </section>
      <div class="demo reveal delay-2">
        <div class="demo-head">
          <div><p class="eyebrow">Live judge interaction</p><h2>Buy a verified answer now.</h2><p>This triggers a fresh x402 payment. The server delivers an actual FX response, Verity checks it deterministically, Blocky402 settles it on Hedera, and HCS records the receipt.</p></div>
          <button id="run-demo">Run live purchase</button>
        </div>
        <div class="proof-strip"><div>1 · Challenge<strong>HTTP 402</strong></div><div>2 · Delivery<strong>Real provider</strong></div><div>3 · Decision<strong>Published rule</strong></div><div>4 · Evidence<strong>HashScan + HCS</strong></div></div>
        <div class="demo-result" id="demo-result" aria-live="polite"></div>
      </div>
      <div class="grid reveal delay-2">
        <section>
          <h2>Provider reliability</h2>
          <p>Completed work and upheld disputes for a standard ERC-8004 identity.</p>
          <label for="agent">ERC-8004 agent ID</label>
          <div class="controls"><input id="agent" autocomplete="off" placeholder="chain:agent ID"><button data-kind="provider">Inspect</button></div>
          <pre id="provider" aria-live="polite"></pre>
        </section>
        <section>
          <h2>Buyer honesty</h2>
          <p>Dispute behavior attached to a reusable World ID session commitment.</p>
          <label for="root">Human root</label>
          <div class="controls"><input id="root" autocomplete="off" placeholder="session commitment"><button data-kind="buyer">Inspect</button></div>
          <pre id="buyer" aria-live="polite"></pre>
        </section>
      </div>
      <div class="status">Source: <code>GraphReputationClient</code> · <a href="/health" style="color:#8ee6c1">health</a></div>
    </main>
    <script>
      const demoButton = document.getElementById('run-demo');
      demoButton.addEventListener('click', async () => {
        const output = document.getElementById('demo-result');
        output.classList.add('visible');
        output.classList.remove('demo-error');
        output.textContent = 'Requesting paid data → checking answer → settling on Hedera…';
        demoButton.disabled = true;
        try {
          const response = await fetch('/demo/honest', { method: 'POST' });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || 'live purchase failed');
          output.innerHTML = renderReceipt(body);
        } catch (error) {
          output.classList.add('demo-error');
          output.textContent = error instanceof Error ? error.message : String(error);
        } finally {
          demoButton.disabled = false;
        }
      });
      function renderReceipt(body) {
        const events = Array.isArray(body.events) ? body.events : [];
        const settlementEvent = events.find((event) => event && event.settlement && event.settlement.transaction);
        const verdictEvent = events.find((event) => event && event.verdict);
        const hcsEvent = events.find((event) => event && event.hcsTransactionId);
        const settlement = settlementEvent?.settlement || {};
        const verdict = verdictEvent?.verdict || {};
        const requestId = settlementEvent?.requestId || verdictEvent?.requestId || 'unavailable';
        const payment = settlement.transaction || 'unavailable';
        const hcs = hcsEvent?.hcsTransactionId || 'unavailable';
        const scan = (value) => 'https://hashscan.io/testnet/transaction/' + encodeURIComponent(value);
        const link = (value, label) => value === 'unavailable' ? '<span>' + label + ' pending</span>' : '<a href="' + scan(value) + '" target="_blank" rel="noreferrer">' + label + ' ↗</a>';
        return '<article class="live-receipt-card">' +
          '<div class="signed-label">Signed settlement receipt · Hedera testnet</div>' +
          '<div class="settled-label">SETTLED · ' + escapeReceipt(verdict.reasonCode || 'verified') + '</div>' +
          '<p class="receipt-note">The buyer signed the payment, the answer passed <code>' + escapeReceipt(verdict.ruleId || 'published rule') + '</code>, and Hedera consensus anchored the result.</p>' +
          '<div class="live-receipt-grid">' +
            '<div>Decision<strong>' + escapeReceipt(verdict.verdict || 'accept') + '</strong></div>' +
            '<div>Network<strong>' + escapeReceipt(settlement.network || 'hedera:testnet') + '</strong></div>' +
            '<div>Request<strong>' + escapeReceipt(requestId) + '</strong></div>' +
          '</div>' +
          '<div class="receipt-proof-links">' + link(payment, 'Payment transaction') + link(hcs, 'HCS receipt') + '</div>' +
        '</article>';
      }
      function escapeReceipt(value) {
        return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
      }
      for (const button of document.querySelectorAll('button[data-kind]')) {
        button.addEventListener('click', async () => {
          const kind = button.dataset.kind;
          const input = document.getElementById(kind === 'provider' ? 'agent' : 'root');
          const output = document.getElementById(kind);
          const value = input.value.trim();
          if (!value) { output.textContent = 'Enter a lookup key.'; return; }
          output.textContent = 'Loading…';
          try {
            const response = await fetch('/' + kind + '?' + (kind === 'provider' ? 'agentId=' : 'root=') + encodeURIComponent(value));
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || 'lookup failed');
            output.textContent = JSON.stringify(body, null, 2);
          } catch (error) {
            output.textContent = error instanceof Error ? error.message : String(error);
          }
        });
      }
      const initial = new URLSearchParams(location.search);
      for (const [kind, key] of [['provider', 'agentId'], ['buyer', 'root']]) {
        const value = initial.get(key);
        if (!value) continue;
        document.getElementById(kind === 'provider' ? 'agent' : 'root').value = value;
        document.querySelector('button[data-kind="' + kind + '"]').click();
      }
    </script>
  </body>
</html>`;
