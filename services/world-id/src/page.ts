import type { WorldIdProofMode } from "@verity/agent";

export function renderWorldIdProofPage(proofMode: WorldIdProofMode): string {
  return String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Verity identity proof</title>
    <script src="https://cdn.jsdelivr.net/npm/@worldcoin/idkit-core@4.2.4/dist/idkit.global.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
    <style>
      :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #08131a; color: #e8f0ff; }
      body { margin: 0; padding: 32px; }
      main { max-width: 780px; margin: auto; }
      label { display: block; margin: 18px 0 6px; color: #9cb0d0; }
      input, textarea, button { box-sizing: border-box; width: 100%; border: 1px solid #29415d; border-radius: 8px; padding: 12px; background: #0d1d2b; color: #e8f0ff; font: inherit; }
      textarea { min-height: 180px; resize: vertical; }
      button { margin-top: 20px; background: #8ee6c1; color: #08131a; font-weight: 700; cursor: pointer; }
      button:disabled { cursor: wait; opacity: .65; }
      a { color: #8ee6c1; overflow-wrap: anywhere; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #0d1d2b; border-radius: 8px; padding: 12px; min-height: 24px; }
      .note { color: #9cb0d0; line-height: 1.5; }
      .error { color: #ff9e9e; }
      .hidden { display: none; }
      .request-panel { margin-top: 24px; padding: 20px; border: 1px solid #29415d; border-radius: 12px; background: #0a1824; }
      .qr { width: 280px; min-height: 40px; margin: 16px auto; padding: 16px; border-radius: 8px; background: #fff; }
      .qr img, .qr canvas { display: block; max-width: 100%; margin: auto; }
      .connector-value { max-height: 120px; margin: 16px 0 0; }
    </style>
  </head>
  <body>
    <main data-verity-build="qr-flow">
      <h1>Verity Proof of Human</h1>
      <p class="note">This operator page obtains a World ID proof bound to the exact signal that a Verity command will verify. The proof is shown locally so you can copy the complete JSON into your ignored <code>.env</code>; never put signing keys there or in chat.</p>
      <p class="note">Desktop flow: click <strong>Open World ID</strong>. The QR request appears here after IDKit creates it; scan it with World App or open the request link in the staging simulator.</p>
      <p id="modeNote" class="note"></p>
      <label id="actionLabel" for="action">World action</label>
      <input id="action" value="verity-dispute" autocomplete="off">
      <label for="signal">Signal</label>
      <input id="signal" placeholder="a unique request or provider registration signal" autocomplete="off">
      <div id="sessionFields" class="hidden">
        <label for="sessionId">Existing session ID (leave blank to create one)</label>
        <input id="sessionId" placeholder="session_…" autocomplete="off">
        <p class="note">Save this session ID. It is the stable human root; each proof still has its own replay-protection value.</p>
      </div>
      <button id="start">Open World ID</button>
      <p id="status" class="note" aria-live="polite"></p>
      <section id="requestPanel" class="request-panel" hidden aria-live="polite">
        <h2>Scan or open the request</h2>
        <p id="qrStatus" class="note">Preparing the QR request…</p>
        <div id="qr" class="qr" hidden aria-label="World ID request QR code"></div>
        <p><a id="connector" hidden target="_blank" rel="noreferrer">Open the World ID request</a></p>
        <pre id="connectorValue" class="connector-value hidden"></pre>
      </section>
      <label for="proof">Complete IDKit proof JSON</label>
      <textarea id="proof" readonly></textarea>
      <label for="verification">Developer Portal verification response</label>
      <pre id="verification"></pre>
    </main>
    <script>
      const proofMode = ${JSON.stringify(proofMode)};
      const sessionMode = proofMode === 'session';
      const modeNote = document.getElementById('modeNote');
      const actionLabel = document.getElementById('actionLabel');
      const actionInput = document.getElementById('action');
      const signalInput = document.getElementById('signal');
      const sessionFields = document.getElementById('sessionFields');
      const sessionIdInput = document.getElementById('sessionId');
      const startButton = document.getElementById('start');
      const statusOutput = document.getElementById('status');
      const requestPanel = document.getElementById('requestPanel');
      const qrStatus = document.getElementById('qrStatus');
      const connector = document.getElementById('connector');
      const qr = document.getElementById('qr');
      const connectorValue = document.getElementById('connectorValue');
      const proofOutput = document.getElementById('proof');
      const verificationOutput = document.getElementById('verification');

      if (sessionMode) {
        modeNote.textContent = 'Session mode is enabled: the session commitment becomes the durable human root shared by provider registration and disputes.';
        actionLabel.className = 'hidden';
        actionInput.className = 'hidden';
        sessionFields.className = '';
      } else {
        modeNote.textContent = 'Uniqueness mode is enabled: the World nullifier is scoped to the configured action.';
      }

      startButton.addEventListener('click', async () => {
        const action = actionInput.value.trim();
        const signal = signalInput.value.trim();
        const sessionId = sessionIdInput.value.trim();
        if ((!sessionMode && !action) || !signal) {
          statusOutput.textContent = sessionMode ? 'Enter a signal.' : 'Enter both an action and a signal.';
          statusOutput.className = 'error';
          return;
        }
        startButton.disabled = true;
        requestPanel.hidden = true;
        connector.hidden = true;
        qr.hidden = true;
        connectorValue.className = 'connector-value hidden';
        connectorValue.textContent = '';
        qrStatus.className = 'note';
        proofOutput.value = '';
        verificationOutput.textContent = '';
        statusOutput.className = 'note';
        try {
          if (!window.IDKit) throw new Error('IDKit did not load; check the browser network connection and reload.');
          statusOutput.textContent = 'Requesting a signed context…';
          const signatureResponse = await fetch('/rp-signature', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(sessionMode
              ? (sessionId ? { session_id: sessionId } : {})
              : { action })
          });
          const signature = await signatureResponse.json();
          if (!signatureResponse.ok) throw new Error(signature.error || 'The identity service rejected the request.');
          const rpContext = {
            rp_id: signature.rp_id,
            nonce: signature.nonce,
            created_at: signature.created_at,
            expires_at: signature.expires_at,
            signature: signature.sig
          };
          let request;
          if (sessionMode) {
            const sessionConfig = {
              app_id: signature.app_id,
              rp_context: rpContext,
              environment: signature.environment
            };
            const builder = sessionId
              ? window.IDKit.proveSession(sessionId, sessionConfig)
              : window.IDKit.createSession(sessionConfig);
            request = await builder.constraints(window.IDKit.CredentialRequest('proof_of_human', { signal }));
          } else {
            request = await window.IDKit.request({
              app_id: signature.app_id,
              action,
              rp_context: rpContext,
              allow_legacy_proofs: false,
              environment: signature.environment
            }).preset(window.IDKit.proofOfHuman({ signal }));
          }
          const connectorURI = typeof request.connectorURI === 'string' ? request.connectorURI.trim() : '';
          if (!connectorURI) throw new Error('VERITY_WORLD_CONNECTOR_MISSING: IDKit did not return a request URL; reload and try again.');
          requestPanel.hidden = false;
          connector.href = connectorURI;
          connector.textContent = 'Open the World ID request in World App';
          connector.hidden = false;
          connectorValue.textContent = connectorURI;
          connectorValue.className = 'connector-value';
          if (window.QRCode && qr) {
            qr.textContent = '';
            try {
              new window.QRCode(qr, { text: connectorURI, width: 280, height: 280, correctLevel: window.QRCode.CorrectLevel.M });
              qrStatus.textContent = 'Scan this QR code with World App, or use the request link below.';
              qr.hidden = false;
            } catch (error) {
              qrStatus.textContent = 'The QR renderer failed; use the request link below or open the staging simulator.';
              qrStatus.className = 'error';
              console.error('Verity QR render failed', error);
            }
          } else {
            qrStatus.textContent = 'The QR renderer did not load; use the request link below or open the staging simulator.';
            qrStatus.className = 'error';
          }
          statusOutput.textContent = 'Approve the request in World App or the simulator; this page is polling for completion.';
          const completion = await request.pollUntilCompletion({ pollInterval: 2000, timeout: 120000 });
          if (!completion.success) throw new Error(completion.error || 'World ID did not complete the request.');
          if (sessionMode && completion.result.session_id) sessionIdInput.value = completion.result.session_id;
          proofOutput.value = JSON.stringify(completion.result, null, 2);
          statusOutput.textContent = 'Proof received. Verifying it with the configured Developer Portal endpoint…';
          const verificationResponse = await fetch('/verify-proof', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ idkitResponse: completion.result })
          });
          const verification = await verificationResponse.json();
          verificationOutput.textContent = JSON.stringify(verification, null, 2);
          if (!verificationResponse.ok || verification.success !== true) throw new Error(verification.error || 'Developer Portal verification failed.');
          statusOutput.textContent = sessionMode
            ? 'Verified. Save the session ID and copy the complete proof JSON; use prove-session with the same session ID for the next request.'
            : 'Verified. Copy the complete proof JSON above; use the same signal when running Verity.';
        } catch (error) {
          statusOutput.textContent = error instanceof Error ? error.message : String(error);
          statusOutput.className = 'error';
        } finally {
          startButton.disabled = false;
        }
      });
    </script>
  </body>
</html>`;
}

export const WORLD_ID_PROOF_PAGE = renderWorldIdProofPage("uniqueness");
