import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PROOF_PATH = path.join(PROJECT_ROOT, "deploy", "proof.json");
const FRONTEND_PUBLIC_PROOF = path.join(PROJECT_ROOT, "frontend", "public", "proof.json");
const FRONTEND_DATA_PROOF = path.join(PROJECT_ROOT, "frontend", "src", "data", "proof.json");

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpcCall(rpcUrl, method, params) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const resp = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": BROWSER_UA,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if ([429, 502, 503, 504].includes(resp.status) && attempt < 4) {
        await sleep(5000 * attempt);
        continue;
      }
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} on ${method}`);
      }
      const data = await resp.json();
      if (data.error) {
        throw new Error(`RPC error on ${method}: ${JSON.stringify(data.error)}`);
      }
      return data.result;
    } catch (err) {
      lastErr = err;
      if (attempt < 4) {
        await sleep(5000 * attempt);
      }
    }
  }
  throw lastErr;
}

function collectTxHashes(proof) {
  const entries = [];
  const seen = new Set();

  const add = (label, hash) => {
    if (!hash || typeof hash !== "string") return;
    const norm = hash.trim();
    if (!seen.has(norm)) {
      seen.add(norm);
      entries.push({ label, hash: norm });
    }
  };

  add("deploy_tx_hash", proof.deploy_tx_hash);
  for (const c of proof.cases || []) {
    add(`${c.case_id}:register`, c.register_tx_hash);
    add(`${c.case_id}:challenge`, c.challenge_tx_hash);
    add(`${c.case_id}:resolve`, c.resolve_tx_hash);
    add(`${c.case_id}:expired`, c.expiry_fallback?.expired_tx_hash);
    add(`${c.case_id}:withdraw`, c.withdraw_tx_hash);
  }
  return entries;
}

async function main() {
  if (!fs.existsSync(PROOF_PATH)) {
    throw new Error(`Missing proof file at ${PROOF_PATH}`);
  }
  const proofText = fs.readFileSync(PROOF_PATH, "utf8");
  const proof = JSON.parse(proofText);

  if (proof.is_placeholder) {
    throw new Error("deploy/proof.json still has is_placeholder=true");
  }
  if (!proof.contract_address || !proof.deploy_tx_hash) {
    throw new Error("deploy/proof.json missing contract_address or deploy_tx_hash");
  }

  const rpcUrl = proof.network?.rpc_url || "https://studio.genlayer.com/api";
  const chainIdHex = await rpcCall(rpcUrl, "eth_chainId", []);
  const chainId = Number.parseInt(chainIdHex, 16);
  if (chainId !== 61999) {
    throw new Error(`Unexpected StudioNet chain_id=${chainId} (expected 61999)`);
  }

  const txEntries = collectTxHashes(proof);
  if (txEntries.length === 0) {
    throw new Error("No transaction hashes found in deploy/proof.json");
  }

  let verifiedCount = 0;
  for (const { label, hash } of txEntries) {
    const tx = await rpcCall(rpcUrl, "eth_getTransactionByHash", [hash]);
    if (!tx) {
      throw new Error(`Transaction not found on StudioNet: ${label} (${hash})`);
    }
    const status = tx.status_name || tx.status;
    const resultName = tx.result_name || "";
    const leaderExec = tx.consensus_data?.leader_receipt?.[0]?.execution_result || "";

    if (status !== "FINALIZED") {
      throw new Error(`Tx ${label} (${hash}) status=${status}, expected FINALIZED`);
    }
    if (resultName !== "MAJORITY_AGREE") {
      throw new Error(`Tx ${label} (${hash}) result_name=${resultName}, expected MAJORITY_AGREE`);
    }
    if (leaderExec !== "SUCCESS") {
      throw new Error(`Tx ${label} (${hash}) leader execution_result=${leaderExec}, expected SUCCESS`);
    }
    if (label === "deploy_tx_hash") {
      const deployedAddr = tx.data?.contract_address || tx.to_address || tx.recipient || "";
      if (deployedAddr.toLowerCase() !== proof.contract_address.toLowerCase()) {
        throw new Error(
          `Deploy tx contract address (${deployedAddr}) != proof.contract_address (${proof.contract_address})`,
        );
      }
    }
    verifiedCount += 1;
    console.log(`[OK] ${label} -> ${hash} (${status} / ${resultName} / ${leaderExec})`);
    await sleep(300);
  }

  for (const mirrorPath of [FRONTEND_PUBLIC_PROOF, FRONTEND_DATA_PROOF]) {
    if (fs.existsSync(mirrorPath)) {
      const mirrorText = fs.readFileSync(mirrorPath, "utf8");
      if (mirrorText.trim() !== proofText.trim()) {
        throw new Error(`Mirror mismatch: ${mirrorPath} differs from deploy/proof.json`);
      }
      console.log(`[OK] Mirror synced: ${path.relative(PROJECT_ROOT, mirrorPath)}`);
    }
  }

  console.log(
    `Verified ${verifiedCount} finalized StudioNet transactions for contract ${proof.contract_address} on chain ${chainId}.`,
  );
}

main().catch((err) => {
  console.error(`verify:proof FAILED: ${err.message}`);
  process.exit(1);
});
